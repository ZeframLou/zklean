import { dirname, join, resolve } from "node:path";
import type { NativeOptions } from "./native.ts";
import { runLake } from "./lean.ts";
import { object } from "./encoding.ts";

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

async function locate(
  name: string,
  override: string | undefined,
  environment: string | undefined,
  defaults: (string | undefined)[],
): Promise<string | undefined> {
  const selected = override ?? environment;
  if (selected !== undefined) {
    if (!selected || !(await Bun.file(selected).exists()))
      throw new Error(`${name} not found: ${selected}`);
    return resolve(selected);
  }
  return first(defaults);
}

/** Locate bundled tools first, with source-tree paths as a development fallback. */
export async function findTools(overrides: ToolOverrides = {}): Promise<Tools> {
  return {
    binary:
      (await locate(
        "native binary",
        overrides.binary,
        process.env.ZKLEAN_NATIVE,
        [
          join(installedRoot, "libexec", "zklean-native"),
          join(sourceRoot, "target", "release", "zklean-native"),
        ],
      )) ??
      resolve(
        overrides.binary ??
          process.env.ZKLEAN_NATIVE ??
          "target/release/zklean-native",
      ),
    elf: await locate(
      "guest ELF",
      overrides.elf,
      process.env.ZKLEAN_GUEST_ELF,
      [
        join(installedRoot, "libexec", "zklean-guest"),
        join(
          sourceRoot,
          "crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest",
        ),
      ],
    ),
    exporter: await locate(
      "Lean exporter",
      overrides.exporter,
      process.env.ZKLEAN_EXPORTER,
      [
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
      ],
    ),
    lake: await locate("Lake", overrides.lake, process.env.ZKLEAN_LAKE, [
      join(installedRoot, "libexec", "lean", "bin", "lake"),
      join(
        process.env.ELAN_HOME ?? join(process.env.HOME ?? "", ".elan"),
        "bin",
        "lake",
      ),
      Bun.which("lake") ?? undefined,
    ]),
    config: await locate(
      "verifier profile",
      overrides.config,
      process.env.ZKLEAN_PROFILE,
      [
        join(installedRoot, "share", "zklean", "verifier.json"),
        join(sourceRoot, "examples", "generated", "verifier.json"),
      ],
    ),
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
  const profile = object(await Bun.file(tools.config).json());
  if (
    profile.format !== "zklean/verifier-profile/1" ||
    profile.sp1Version !== "5.2.4" ||
    Object.keys(profile).some(
      (key) =>
        ![
          "format",
          "sp1Version",
          "verifierKey",
          "elfSha256",
          "elfPath",
          "timeout",
        ].includes(key),
    )
  )
    throw new Error("invalid or unsupported verifier profile");
  if (
    typeof profile.verifierKey !== "string" ||
    !/^0x[a-f0-9]{64}$/.test(profile.verifierKey)
  )
    throw new Error("invalid verifier profile key");
  if (
    profile.elfSha256 !== undefined &&
    (typeof profile.elfSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(profile.elfSha256))
  )
    throw new Error("invalid verifier profile ELF digest");
  if (
    profile.elfPath !== undefined &&
    (typeof profile.elfPath !== "string" || !profile.elfPath)
  )
    throw new Error("invalid verifier profile ELF path");
  if (
    profile.timeout !== undefined &&
    (!Number.isSafeInteger(profile.timeout) ||
      (profile.timeout as number) < 1 ||
      (profile.timeout as number) > 0x7fffffff)
  )
    throw new Error("invalid verifier profile timeout");
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
