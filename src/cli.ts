#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { version } from "../package.json";
import { nativeBackend, runNative } from "./native.ts";
import { parseCertificate } from "./encoding.ts";
import { groth16Backend } from "./groth16.ts";
import { createVerifier } from "./verifier.ts";
import { exportModule, findTools, nativeOptions } from "./tooling.ts";
import type { ProveInput } from "./native.ts";
import { checkAxioms } from "./policy.ts";
import type { Certificate, VerifyOptions } from "./types.ts";
import { leanModule } from "./import.ts";
import { declarationIdentity } from "./context.ts";
import { readModel } from "./encoding.ts";

const help = `ZKLean — check and certify Lean contracts

  zklean prove --project DIR --module NAME --claims A,B --out CERT.json [--timeout MS]
  zklean verify --certificate CERT.json [--axioms A,B]
  zklean import --certificate CERT.json --out Remote.lean [--axioms A,B]
  zklean requirements --project DIR --module NAME --claims A,B --out FILE.json
  zklean check --project DIR --module NAME --claims A,B [--axioms A,B]

  zklean export --project DIR --module NAME --out FILE.ndjson [--claims A,B]
  zklean pin --out PROFILE.json [--elf FILE]

The installer supplies the prover/verifier, guest, exporter, and pinned Lean.
Every source command also accepts --export FILE instead of --project/--module.
Advanced overrides: --config, --binary, --elf, --lake, and --exporter.
Custom axioms require --axiom-policy FILE containing reviewed declaration fingerprints.
`;

const list = (value: string | undefined) =>
  value ? value.split(",").filter(Boolean) : [];

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "help") {
    console.log(help);
    return;
  }
  if (command === "--version" || command === "version") {
    console.log(`zklean ${version}`);
    return;
  }
  const { values } = parseArgs({
    args: args.slice(1),
    strict: true,
    options: Object.fromEntries(
      [
        "project",
        "module",
        "exporter",
        "lake",
        "out",
        "export",
        "claims",
        "axioms",
        "axiom-policy",
        "config",
        "certificate",
        "binary",
        "elf",
        "timeout",
      ].map((key) => [key, { type: "string" as const }]),
    ),
  });
  const required = (name: string): string => {
    const value = values[name];
    if (typeof value !== "string" || !value)
      throw new Error(`--${name} is required`);
    return value;
  };
  const optional = (name: string) =>
    typeof values[name] === "string" ? (values[name] as string) : undefined;
  const timeout =
    optional("timeout") === undefined ? undefined : Number(optional("timeout"));
  if (
    timeout !== undefined &&
    (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 0x7fffffff)
  )
    throw new Error(
      "--timeout must be an integer from 1 to 2147483647 milliseconds",
    );
  const tools = await findTools({
    binary: optional("binary"),
    elf: optional("elf"),
    exporter: optional("exporter"),
    lake: optional("lake"),
    config: optional("config"),
  });

  if (command === "pin") {
    const elfPath = tools.elf ?? resolve(required("elf"));
    const identity = (await runNative(tools.binary, "identity", {
      elfPath,
    })) as object;
    await Bun.write(
      required("out"),
      `${JSON.stringify(
        {
          format: "zklean/verifier-profile/1",
          sp1Version: "5.2.4",
          ...identity,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const claims = list(optional("claims"));
  const policy: VerifyOptions = {
    allowedAxioms: list(optional("axioms")),
    ...(optional("axiom-policy")
      ? { axiomPins: await Bun.file(required("axiom-policy")).json() }
      : {}),
  };
  const enforcePolicy = (statement: Pick<Certificate, "specs" | "axioms">) => {
    const reason = checkAxioms(statement, policy);
    if (reason) throw new Error(`axiom policy rejected the model: ${reason}`);
  };
  const exported = async (): Promise<string> => {
    const path = optional("export");
    if (path) return Bun.file(path).text();
    return exportModule({
      project: resolve(required("project")),
      module: required("module"),
      claims,
      tools,
    });
  };

  if (command === "export") {
    await Bun.write(required("out"), await exported());
    return;
  }

  let result: unknown;
  if (["check", "requirements", "prove"].includes(command)) {
    if (claims.length === 0) throw new Error("--claims is required");
    const input: ProveInput = {
      export: await exported(),
      claims,
      allowedAxioms: list(optional("axioms")),
    };
    if (command === "prove") {
      enforcePolicy(
        (await runNative(tools.binary, "check", input)) as Certificate,
      );
      console.error(
        "Generating a local Groth16 proof; large models may take hours…",
      );
      result = await nativeBackend({
        ...(await nativeOptions(tools, true)),
        ...(timeout === undefined ? {} : { timeout }),
        onProgress: (text) => {
          process.stderr.write(text);
        },
      }).prove(input);
    } else {
      result = await runNative(tools.binary, command, input);
      if (command === "check") enforcePolicy(result as Certificate);
    }
  } else if (["verify", "import"].includes(command)) {
    const certificate = parseCertificate(
      await Bun.file(required("certificate")).json(),
    );
    result = await createVerifier({
      ...(tools.config
        ? {
            backend: groth16Backend(
              (await nativeOptions(tools, false)).verifierKey,
            ),
          }
        : {}),
    }).verify(certificate, policy);
    if ((result as { status: string }).status !== "verified") {
      process.exitCode = 1;
      if (command !== "verify") {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
    } else if (command === "import") {
      const path = required("out");
      await Bun.write(path, leanModule(certificate));
      const model = readModel(certificate.specs);
      await Bun.write(
        `${path}.axioms.json`,
        `${JSON.stringify(
          Object.fromEntries(
            certificate.specs.claims.map((name) => [
              name,
              declarationIdentity(model, name),
            ]),
          ),
          null,
          2,
        )}\n`,
      );
      return;
    }
  } else {
    throw new Error(`unknown command: ${command}\n${help}`);
  }
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (optional("out")) await Bun.write(required("out"), text);
  else process.stdout.write(text);
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
