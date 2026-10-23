import { dirname, join, resolve } from "node:path";
import type { NativeOptions } from "./native.ts";
import { runLake } from "./lean.ts";

export interface ToolOverrides {
  binary?: string | undefined;
  elf?: string | undefined;
  exporter?: string | undefined;
  lake?: string | undefined;
  config?: string | undefined;
}

export interface Tools {
  binary: string;
  elf?: string | undefined;
  exporter?: string | undefined;
  lake?: string | undefined;
  config?: string | undefined;
}

const installedRoot = resolve(dirname(process.execPath), "..");
const sourceRoot = resolve(import.meta.dir, "..");

async function first(
  paths: (string | undefined)[],
): Promise<string | undefined> {
  for (const path of paths) {
    if (path && (await Bun.file(path).exists())) return resolve(path);
  }
}

/** Locate bundled tools first, with source-tree paths as a development fallback. */
export async function findTools(overrides: ToolOverrides = {}): Promise<Tools> {
  return {
    binary:
      (await first([
        overrides.binary,
        process.env.ZKLEAN_NATIVE,
        join(installedRoot, "libexec", "zklean-native"),
        join(sourceRoot, "target", "release", "zklean-native"),
      ])) ??
      resolve(
        overrides.binary ??
          process.env.ZKLEAN_NATIVE ??
          "target/release/zklean-native",
      ),
    elf: await first([
      overrides.elf,
      process.env.ZKLEAN_GUEST_ELF,
      join(installedRoot, "libexec", "zklean-guest"),
      join(
        sourceRoot,
        "crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest",
      ),
    ]),
    exporter: await first([
      overrides.exporter,
      process.env.ZKLEAN_EXPORTER,
      join(installedRoot, "libexec", "lean4export"),
      join(
        sourceRoot,
        ".tooling",
        "lean4export",
        ".lake",
        "build",
        "bin",
        "lean4export",
      ),
    ]),
    lake: await first([
      overrides.lake,
      process.env.ZKLEAN_LAKE,
      join(installedRoot, "libexec", "lean", "bin", "lake"),
      join(
        process.env.ELAN_HOME ?? join(process.env.HOME ?? "", ".elan"),
        "bin",
        "lake",
      ),
      Bun.which("lake") ?? undefined,
    ]),
    config: await first([
      overrides.config,
      process.env.ZKLEAN_PROFILE,
      join(installedRoot, "share", "zklean", "verifier.json"),
      join(sourceRoot, "examples", "generated", "verifier.json"),
    ]),
  };
}

function configuredPath(path: unknown, config: string): string | undefined {
  return typeof path === "string" && path
    ? resolve(dirname(config), path)
    : undefined;
}

export async function nativeOptions(
  tools: Tools,
  proving: boolean,
): Promise<NativeOptions> {
  if (!tools.config)
    throw new Error(
      "verifier profile not found; reinstall ZKLean or pass --config",
    );
  const profile = (await Bun.file(tools.config).json()) as Record<
    string,
    unknown
  >;
  const elfPath = proving
    ? (tools.elf ?? configuredPath(profile.elfPath, tools.config))
    : undefined;
  const options: NativeOptions = {
    binary: tools.binary,
    verifierKey: String(profile.verifierKey ?? ""),
    ...(elfPath ? { elfPath } : {}),
    ...(elfPath && typeof profile.elfSha256 === "string"
      ? { elfSha256: profile.elfSha256 }
      : {}),
    ...(typeof profile.timeout === "number"
      ? { timeout: profile.timeout }
      : {}),
  };
  if (proving && (!options.elfPath || !options.elfSha256))
    throw new Error(
      "installed verifier profile does not contain a pinned guest ELF",
    );
  return options;
}

export async function exportModule(options: {
  project: string;
  module: string;
  claims: string[];
  tools: Tools;
}): Promise<string> {
  if (!options.tools.lake || !options.tools.exporter)
    throw new Error(
      "Lean tools not found; reinstall ZKLean or pass --lake and --exporter",
    );
  if (
    !/^[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*$/.test(
      options.module,
    )
  )
    throw new Error("invalid Lean module name");
  const cwd = resolve(options.project);
  await runLake(cwd, options.tools.lake, ["build", options.module]);
  return runLake(cwd, options.tools.lake, [
    "env",
    options.tools.exporter,
    options.module,
    ...(options.claims.length ? ["--", ...options.claims] : []),
  ]);
}
