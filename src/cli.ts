#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { version } from "../package.json";
import { nativeBackend, runNative } from "./native.ts";
import { canonical, parseCertificate } from "./encoding.ts";
import { groth16Backend } from "./groth16.ts";
import { createVerifier } from "./verifier.ts";
import { createSourceManifest } from "./requirements.ts";
import { exportModule, findTools, nativeOptions } from "./tooling.ts";
import type { ProveInput } from "./native.ts";
import { resolveLeanSource } from "./lean.ts";
import { checkAxioms } from "./policy.ts";
import type { Certificate, VerifyOptions } from "./types.ts";
import { leanModule } from "./import.ts";
import { declarationIdentity } from "./context.ts";
import { readModel } from "./encoding.ts";
import { runLake } from "./lean.ts";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import inventorySource from "../examples/lean/Inventory.lean" with { type: "text" };
import exampleSource from "../examples/lean/V1.lean" with { type: "text" };
import { tmpdir } from "node:os";
import { join } from "node:path";

const help = `ZKLean — check and certify Lean contracts

  zklean init --project DIR
  zklean prove --project DIR --module NAME --claims A,B --out CERT.json
  zklean verify --certificate CERT.json [--axioms A,B]
  zklean inspect --certificate CERT.json [--axioms A,B]
  zklean import --certificate CERT.json --out Remote.lean [--axioms A,B]
  zklean requirements --project DIR --module NAME --claims A,B --out FILE.json
  zklean check --project DIR --module NAME --claims A,B [--axioms A,B]

  zklean export --project DIR --module NAME --out FILE.ndjson [--claims A,B]
  zklean pin --out PROFILE.json [--elf FILE]
  zklean doctor

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
  if (command === "init") {
    const project = resolve(required("project"));
    const files = {
      "lean-toolchain": "leanprover/lean4:v4.36.0-rc1\n",
      "lakefile.toml":
        'name = "Contract"\n[[lean_lib]]\nname = "Contract"\nroots = ["Inventory", "V1"]\n',
      "Inventory.lean": inventorySource,
      "V1.lean": exampleSource,
    };
    for (const name of Object.keys(files))
      if (await Bun.file(join(project, name)).exists())
        throw new Error(`refusing to overwrite ${join(project, name)}`);
    await mkdir(project, { recursive: true });
    for (const [name, text] of Object.entries(files))
      await writeFile(join(project, name), text, { flag: "wx" });
    const quotedProject = `'${project.replaceAll("'", "'\\''")}'`;
    console.log(
      `Created ${project}. Run zklean prove --project ${quotedProject} --module V1 --claims Inventory.reservation_safe --axioms propext --out reservation.json`,
    );
    return;
  }
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
  const exported = async (): Promise<{
    text: string;
    source: string | undefined;
  }> => {
    const path = optional("export");
    if (path)
      return { text: await Bun.file(path).text(), source: optional("source") };
    const project = resolve(required("project"));
    const module = required("module");
    const source =
      optional("source") ??
      (await resolveLeanSource(project, module, tools.lake ?? "lake"));
    const before =
      command === "requirements"
        ? await createSourceManifest(source, tools.lake, false)
        : undefined;
    const text = await exportModule({ project, module, claims, tools });
    if (before) {
      const after = await createSourceManifest(source, tools.lake, false);
      if (canonical(before) !== canonical(after))
        throw new Error(
          "Lean sources changed during export; retry requirements generation",
        );
    }
    return { text, source };
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
      enforcePolicy(
        (await runNative(tools.binary, "check", input)) as Certificate,
      );
      console.error(
        "Generating a local Groth16 proof; this may take several minutes…",
      );
      result = await nativeBackend(await nativeOptions(tools, true)).prove(
        input,
      );
    } else {
      result = await runNative(tools.binary, command, input);
      if (command === "check") enforcePolicy(result as Certificate);
      if (command === "requirements" && source.source) {
        Object.assign(result as object, {
          sourceManifest: await createSourceManifest(
            source.source,
            tools.lake ?? "lake",
          ),
        });
      }
    }
  } else if (["verify", "inspect", "import"].includes(command)) {
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
    else if (command === "import") {
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
    } else if (command === "inspect") {
      if (!tools.lake) throw new Error("Lean not found; reinstall ZKLean");
      const directory = await mkdtemp(join(tmpdir(), "zklean-inspect-"));
      try {
        await Bun.write(
          join(directory, "lean-toolchain"),
          "leanprover/lean4:v4.36.0-rc1\n",
        );
        await Bun.write(
          join(directory, "lakefile.toml"),
          'name = "ZKLeanInspection"\n',
        );
        await Bun.write(
          join(directory, "Inspect.lean"),
          leanModule(certificate, true),
        );
        process.stdout.write(
          await runLake(directory, tools.lake, ["env", "lean", "Inspect.lean"]),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
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
