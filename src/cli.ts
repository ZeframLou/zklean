#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { version } from "../package.json";
import { nativeBackend, runNative } from "./native.ts";
import { groth16Backend } from "./groth16.ts";
import { createVerifier } from "./verifier.ts";
import { exportModule, findTools, nativeOptions } from "./tooling.ts";
import type { ProveInput } from "./native.ts";
import { checkAxioms, standardAxioms } from "./policy.ts";
import type { Statement, VerifyOptions } from "./types.ts";
import {
  canonical,
  identified,
  parseCertificate,
  statement as statementOf,
} from "./encoding.ts";
import { download, matchSource } from "./fetch.ts";

const help = `ZKLean — check and certify Lean contracts

  zklean prove --project DIR --module NAME --claims A,B [--definitions D]
      --source URL --out CERT.json [--timeout MS]
  zklean verify --certificate CERT.json [--axioms A,B]
  zklean fetch --certificate CERT.json --out SOURCE.ndjson
  zklean requirements --project DIR --module NAME --claims A,B [--definitions D] --out FILE.json
  zklean check --project DIR --module NAME --claims A,B [--definitions D] [--axioms A,B]

  zklean export --project DIR --module NAME --out FILE.ndjson [--claims A,B] [--definitions D]
  zklean pin --out PROFILE.json [--elf FILE]

The installer supplies the prover/verifier, guest, exporter, and pinned Lean.
Every source command also accepts --export FILE instead of --project/--module.
Advanced overrides: --config, --binary, --elf, --lake, and --exporter.
--axioms names Lean's standard axioms; custom axioms need --axiom-policy FILE
mapping each reviewed axiom name to its identity.
prove writes CERT.json and the export it proved from, CERT.ndjson. Publish that
export at the --source URL: it holds every definition recipients need.
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
        "definitions",
        "axioms",
        "axiom-policy",
        "config",
        "certificate",
        "binary",
        "elf",
        "timeout",
        "source",
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
  const custom = optional("axiom-policy")
    ? identified(await Bun.file(required("axiom-policy")).json())
    : {};
  const names = list(optional("axioms"));
  const policy: VerifyOptions = {
    axioms: Object.fromEntries(
      names.map((name) => {
        const id = custom[name] ?? standardAxioms[name];
        if (!id) throw new Error(`no identity for axiom ${name}`);
        return [name, id];
      }),
    ),
  };
  const enforcePolicy = (statement: Statement) => {
    const reason = checkAxioms(statement, policy);
    if (reason)
      throw new Error(`axiom policy rejected the statement: ${reason}`);
  };
  const exported = async (): Promise<string> => {
    const path = optional("export");
    if (path) return Bun.file(path).text();
    return exportModule({
      project: resolve(required("project")),
      module: required("module"),
      claims: [...claims, ...list(optional("definitions"))],
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
      definitions: list(optional("definitions")),
      allowedAxioms: names,
    };
    if (command === "prove") {
      const statement = (await runNative(
        tools.binary,
        "check",
        input,
      )) as Statement;
      enforcePolicy(statement);
      const source = required("source");
      const out = required("out");
      // Validate the certificate shape before hours of proving.
      parseCertificate({ ...statement, proof: "base64:AA==", source });
      console.error(
        "Generating a local Groth16 proof; large models may take hours…",
      );
      const proved = await nativeBackend({
        ...(await nativeOptions(tools, true)),
        ...(timeout === undefined ? {} : { timeout }),
        onProgress: (text) => {
          process.stderr.write(text);
        },
      }).prove(input, source);
      if (canonical(statement) !== canonical(statementOf(proved)))
        throw new Error("proved statement differs from the checked statement");
      result = proved;
      await Bun.write(out.replace(/\.json$/, "") + ".ndjson", input.export);
    } else {
      result = await runNative(tools.binary, command, input);
      if (command === "check") enforcePolicy(result as Statement);
    }
  } else if (command === "fetch") {
    const certificate = parseCertificate(
      await Bun.file(required("certificate")).json(),
    );
    const exported = await download(certificate.source);
    const mismatches = await matchSource(certificate, exported, tools.binary);
    if (mismatches.length) {
      process.stdout.write(`${JSON.stringify({ mismatches }, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    await Bun.write(required("out"), exported);
    return;
  } else if (command === "verify") {
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
    if ((result as { status: string }).status !== "verified")
      process.exitCode = 1;
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
