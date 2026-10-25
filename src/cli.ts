#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { version } from "../package.json";
import { prove, runNative } from "./native.ts";
import { groth16Backend } from "./groth16.ts";
import { createVerifier } from "./verifier.ts";
import { exportModule, findTools, profile } from "./tooling.ts";
import { checkAxioms, standardAxioms } from "./policy.ts";
import type { Statement, Policy } from "./types.ts";
import {
  SP1_VERSION,
  identified,
  parseCertificate,
  parseSource,
} from "./encoding.ts";
import { download, matchSource } from "./fetch.ts";

const help = `ZKLean — check and certify Lean propositions

  zklean check        --project DIR --module NAME --claims A,B [--axioms A,B]
  zklean prove        --project DIR --module NAME --claims A,B [--axioms A,B]
                      --source URL --out CERT.json [--timeout MS]
  zklean verify       --certificate CERT.json [--axioms A,B]
  zklean fetch        --certificate CERT.json [--axioms A,B] [--from FILE] --out SOURCE.ndjson
  zklean requirements --project DIR --module NAME --claims A,B --out FILE.json
  zklean export       --project DIR --module NAME [--claims NAMES] --out FILE.ndjson
  zklean pin          --out PROFILE.json

Source commands accept --export FILE instead of --project and --module. For
export, --claims names any declarations to include with their dependencies.
--axioms names permitted axioms: Lean's standard axioms, or names given
identities in --axiom-policy FILE, a JSON object mapping names to identities.
prove writes CERT.json and CERT.ndjson, the export it proved from; publish the
export at the --source URL. fetch verifies the certificate, then checks that the
source (or --from FILE) reproduces every identity before saving it.
ZKLEAN_NATIVE, ZKLEAN_GUEST_ELF, ZKLEAN_EXPORTER, ZKLEAN_LAKE and ZKLEAN_PROFILE
override the bundled tools.
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
        "export",
        "claims",
        "axioms",
        "axiom-policy",
        "certificate",
        "source",
        "from",
        "out",
        "timeout",
      ].map((key) => [key, { type: "string" as const }]),
    ),
  });
  const optional = (name: string) => values[name] as string | undefined;
  const required = (name: string): string => {
    const value = optional(name);
    if (!value) throw new Error(`--${name} is required`);
    return value;
  };
  const tools = await findTools();

  const custom = optional("axiom-policy")
    ? identified(await Bun.file(required("axiom-policy")).json())
    : {};
  const policy: Policy = {
    axioms: Object.fromEntries(
      list(optional("axioms")).map((name) => {
        const id = Object.hasOwn(custom, name)
          ? custom[name]
          : Object.hasOwn(standardAxioms, name)
            ? standardAxioms[name]
            : undefined;
        if (!id) throw new Error(`no identity for axiom ${name}`);
        return [name, id];
      }),
    ),
  };
  const verify = async (path: string) => {
    const certificate = parseCertificate(await Bun.file(path).json());
    const { verifierKey } = await profile(tools);
    const result = await createVerifier({
      backend: groth16Backend(verifierKey),
    }).verify(certificate, policy);
    return { certificate, result };
  };
  const exported = (claims: string[]): Promise<string> =>
    optional("export")
      ? Bun.file(required("export")).text()
      : exportModule({
          project: resolve(required("project")),
          module: required("module"),
          claims,
          tools,
        });
  const output = async (value: unknown) => {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    if (optional("out")) await Bun.write(required("out"), text);
    else process.stdout.write(text);
  };

  switch (command) {
    case "pin": {
      if (!tools.elf)
        throw new Error("guest ELF not found; set ZKLEAN_GUEST_ELF");
      const identity = await runNative(tools.binary, "identity", {
        elfPath: tools.elf,
      });
      return output({
        format: "zklean/verifier-profile/1",
        sp1Version: SP1_VERSION,
        ...(identity as object),
      });
    }
    case "export":
      await Bun.write(
        required("out"),
        await exported(list(optional("claims"))),
      );
      return;
    case "check":
    case "requirements":
    case "prove": {
      const claims = list(required("claims"));
      const input = { export: await exported(claims), claims };
      if (command === "requirements")
        return output(await runNative(tools.binary, "requirements", input));
      const statement = (await runNative(
        tools.binary,
        "check",
        input,
      )) as Statement;
      const reason = checkAxioms(statement, policy);
      if (reason)
        throw new Error(`axiom policy rejected the statement: ${reason}`);
      if (command === "check") return output(statement);
      const source = required("source");
      const out = required("out");
      // Validate the source before hours of proving.
      parseSource(source);
      console.error("Generating a Groth16 proof; large models may take hours…");
      const timeout = optional("timeout");
      const certificate = await prove(input, source, {
        tools,
        timeout: timeout === undefined ? undefined : Number(timeout),
      });
      await Bun.write(out, `${JSON.stringify(certificate, null, 2)}\n`);
      await Bun.write(out.replace(/\.json$/, "") + ".ndjson", input.export);
      return;
    }
    case "verify": {
      const { result } = await verify(required("certificate"));
      if (result.status !== "verified") process.exitCode = 1;
      return output(result);
    }
    case "fetch": {
      // A forged certificate can name identities that match any export, so a
      // source means something only for a verified certificate.
      const { certificate, result } = await verify(required("certificate"));
      const fail = (value: unknown) => {
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
        process.exitCode = 1;
      };
      if (result.status !== "verified") return fail(result);
      const from = optional("from");
      const source = from
        ? await Bun.file(from).text()
        : await download(certificate.source);
      const mismatches = await matchSource(certificate, source, tools.binary);
      if (mismatches.length) return fail({ mismatches });
      await Bun.write(required("out"), source);
      return;
    }
    default:
      throw new Error(`unknown command: ${command}\n${help}`);
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
