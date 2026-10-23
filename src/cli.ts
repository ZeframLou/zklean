#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { nativeBackend, runNative } from "./native.ts";
import { parseCertificate, sha256 } from "./encoding.ts";
import { createHTTPV } from "./client.ts";
import type { NativeOptions, ProveInput } from "./native.ts";

const help = `ZKLean — Lean export, certificates, and HTTPV requirements

  zklean export --project DIR --module NAME --exporter PATH --out FILE [--claims A,B]
  zklean check --export FILE --claims A,B [--axioms A,B] [--out FILE]
  zklean requirements --export FILE --claims A,B --out FILE [--source FILE.lean]
  zklean prove --export FILE --claims A,B --config FILE --out FILE [--axioms A,B]
  zklean verify --certificate FILE --config FILE [--axioms A,B]

Native commands accept --binary PATH (default: target/release/zklean-native).
Config JSON pins binary, elfPath, elfSha256, verifierKey, and optional timeout.
Export runs 'lake build MODULE' and lean4export in the specified Lake project.
A .lean requirement uses a generated FILE.lean.httpv.json sidecar bound to its
source SHA-256; --source writes that binding. No command infers axiom trust.
`;
const list = (value: string | undefined) => value ? value.split(",").filter(Boolean) : [];

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "help") { console.log(help); return; }
  const { values } = parseArgs({ args: args.slice(1), strict: true, options: Object.fromEntries(
    ["project", "module", "exporter", "out", "export", "claims", "axioms", "source", "config", "certificate", "binary"].map(k => [k, { type: "string" as const }]),
  ) });
  const required = (name: string): string => {
    const value = values[name];
    if (typeof value !== "string" || !value) throw new Error(`--${name} is required`);
    return value;
  };
  const optional = (name: string) => typeof values[name] === "string" ? values[name] as string : undefined;
  let result: unknown;
  if (command === "export") {
    const cwd = resolve(required("project"));
    const module = required("module");
    if (!/^[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_']*)*$/.test(module)) throw new Error("invalid Lean module name");
    const build = Bun.spawn(["lake", "build", module], { cwd, stdout: "inherit", stderr: "inherit" });
    if (await build.exited !== 0) throw new Error("Lean module build failed");
    const claims = list(optional("claims"));
    const child = Bun.spawn(["lake", "env", resolve(required("exporter")), module, ...(claims.length ? ["--", ...claims] : [])], { cwd, stdout: "pipe", stderr: "inherit" });
    const output = await new Response(child.stdout).text();
    if (await child.exited !== 0) throw new Error("lean4export failed");
    await Bun.write(required("out"), output);
    return;
  }
  if (["check", "requirements", "prove"].includes(command)) {
    const input: ProveInput = { export: await Bun.file(required("export")).text(), claims: list(required("claims")), allowedAxioms: list(optional("axioms")) };
    if (command === "prove") {
      const config = await Bun.file(required("config")).json() as NativeOptions;
      result = await nativeBackend(config).prove(input);
    } else {
      result = await runNative(optional("binary") ?? "target/release/zklean-native", command, input);
      if (command === "requirements" && optional("source")) {
        Object.assign(result as object, { sourceSha256: sha256(new Uint8Array(await Bun.file(required("source")).arrayBuffer())) });
      }
    }
  } else if (command === "verify") {
    const config = await Bun.file(required("config")).json() as NativeOptions;
    const certificate = parseCertificate(await Bun.file(required("certificate")).json());
    result = await createHTTPV({ backend: nativeBackend(config) }).verify(certificate, { allowedAxioms: list(optional("axioms")) });
    if ((result as { status: string }).status !== "verified") process.exitCode = 1;
  } else throw new Error(`unknown command: ${command}\n${help}`);
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (optional("out")) await Bun.write(required("out"), text);
  else process.stdout.write(text);
}
if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
