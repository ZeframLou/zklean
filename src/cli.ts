#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { version } from "../package.json";
import { nativeBackend, runNative } from "./native.ts";
import { parseCertificate } from "./encoding.ts";
import { createVerifier } from "./verifier.ts";
import { createSourceManifest } from "./requirements.ts";
import { exportModule, findTools, nativeOptions } from "./tooling.ts";
import type { ProveInput } from "./native.ts";

const help = `ZKLean — check and certify Lean contracts

  zklean prove --project DIR --module NAME --claims A,B --out CERT.json
  zklean verify --certificate CERT.json [--axioms A,B]
  zklean requirements --project DIR --module NAME --claims A,B --out FILE.json
  zklean check --project DIR --module NAME --claims A,B [--axioms A,B]

  zklean export --project DIR --module NAME --out FILE.ndjson [--claims A,B]
  zklean pin --out PROFILE.json [--elf FILE]
  zklean doctor

The installer supplies the prover/verifier, guest, exporter, and pinned Lean.
Every source command also accepts --export FILE instead of --project/--module.
Advanced overrides: --config, --binary, --elf, --lake, and --exporter.
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
        "source",
        "config",
        "certificate",
        "binary",
        "elf",
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
  const tools = await findTools({
    binary: optional("binary"),
    elf: optional("elf"),
    exporter: optional("exporter"),
    lake: optional("lake"),
    config: optional("config"),
  });

  if (command === "doctor") {
    const entries = await Promise.all(
      Object.entries(tools).map(async ([name, path]) => ({
        name,
        path: path ?? null,
        available: path ? await Bun.file(path).exists() : false,
      })),
    );
    console.log(
      JSON.stringify(
        Object.fromEntries(entries.map((v) => [v.name, v])),
        null,
        2,
      ),
    );
    return;
  }

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
  const exported = async (): Promise<{
    text: string;
    source: string | undefined;
  }> => {
    const path = optional("export");
    if (path)
      return { text: await Bun.file(path).text(), source: optional("source") };
    const project = resolve(required("project"));
    const module = required("module");
    return {
      text: await exportModule({ project, module, claims, tools }),
      source:
        optional("source") ??
        resolve(project, `${module.replaceAll(".", "/")}.lean`),
    };
  };

  if (command === "export") {
    const result = await exported();
    await Bun.write(required("out"), result.text);
    return;
  }

  let result: unknown;
  if (["check", "requirements", "prove"].includes(command)) {
    if (claims.length === 0) throw new Error("--claims is required");
    const source = await exported();
    const input: ProveInput = {
      export: source.text,
      claims,
      allowedAxioms: list(optional("axioms")),
    };
    if (command === "prove") {
      console.error(
        "Generating a local compressed STARK proof; this may take several minutes…",
      );
      result = await nativeBackend(await nativeOptions(tools, true)).prove(
        input,
      );
    } else {
      result = await runNative(tools.binary, command, input);
      if (command === "requirements" && source.source) {
        Object.assign(result as object, {
          sourceManifest: await createSourceManifest(
            source.source,
            tools.lake ?? "lake",
          ),
        });
      }
    }
  } else if (command === "verify") {
    const certificate = parseCertificate(
      await Bun.file(required("certificate")).json(),
    );
    result = await createVerifier({
      backend: nativeBackend(await nativeOptions(tools, false)),
    }).verify(certificate, { allowedAxioms: list(optional("axioms")) });
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
