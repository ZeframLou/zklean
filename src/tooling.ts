import { dirname, join, resolve } from "node:path";
import { object } from "./encoding.ts";

export interface Tools {
  readonly binary: string;
  elf?: string | undefined;
  exporter?: string | undefined;
  lake?: string | undefined;
  profile: string;
}

const installed = resolve(dirname(process.execPath), "..");
const source = resolve(import.meta.dir, "..");

/** An environment override must exist; otherwise the first existing default
 * is used: the installed layout, then the source tree. */
async function locate(
  variable: string,
  defaults: string[],
): Promise<string | undefined> {
  const selected = process.env[variable];
  if (selected !== undefined) {
    if (!selected || !(await Bun.file(selected).exists()))
      throw new Error(`${variable} not found: ${selected}`);
    return resolve(selected);
  }
  for (const path of defaults)
    if (await Bun.file(path).exists()) return resolve(path);
}

export async function findTools(): Promise<Tools> {
  const elan = process.env.ELAN_HOME ?? join(process.env.HOME ?? "", ".elan");
  const [binary, elf, exporter, lake, profile] = await Promise.all([
    locate("ZKLEAN_NATIVE", [
      join(installed, "libexec", "zklean-native"),
      join(source, "target", "release", "zklean-native"),
    ]),
    locate("ZKLEAN_GUEST_ELF", [
      join(installed, "libexec", "zklean-guest"),
      join(
        source,
        "crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest",
      ),
    ]),
    locate("ZKLEAN_EXPORTER", [
      join(installed, "libexec", "lean4export"),
      join(source, ".tooling/lean4export/.lake/build/bin/lean4export"),
    ]),
    locate("ZKLEAN_LAKE", [
      join(installed, "libexec", "lean", "bin", "lake"),
      join(elan, "bin", "lake"),
      ...(Bun.which("lake") ? [Bun.which("lake")!] : []),
    ]),
    locate("ZKLEAN_PROFILE", [
      join(installed, "share", "zklean", "verifier.json"),
      join(source, "src", "guest.json"),
    ]),
  ]);
  if (!profile)
    throw new Error("verifier profile not found; set ZKLEAN_PROFILE");
  return {
    // Verification needs no native code, so a missing binary fails only on use.
    get binary() {
      if (!binary)
        throw new Error("zklean-native not found; set ZKLEAN_NATIVE");
      return binary;
    },
    elf,
    exporter,
    lake,
    profile,
  };
}

/** The pinned guest: its BN254 verifier key and ELF digest. */
export async function profile(
  tools: Tools,
): Promise<{ verifierKey: string; elfSha256: string }> {
  const p = object(await Bun.file(tools.profile).json());
  if (
    p.format !== "zklean/verifier-profile/1" ||
    p.sp1Version !== "5.2.4" ||
    Object.keys(p).length !== 4 ||
    typeof p.verifierKey !== "string" ||
    !/^0x[a-f0-9]{64}$/.test(p.verifierKey) ||
    typeof p.elfSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(p.elfSha256)
  )
    throw new Error("invalid or unsupported verifier profile");
  return { verifierKey: p.verifierKey, elfSha256: p.elfSha256 };
}

export async function exportModule(options: {
  project: string;
  module: string;
  claims: string[];
  tools: Tools;
}): Promise<string> {
  const { lake, exporter } = options.tools;
  if (!lake || !exporter)
    throw new Error(
      "Lean tools not found; set ZKLEAN_LAKE and ZKLEAN_EXPORTER",
    );
  if (
    !/^[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*$/.test(
      options.module,
    )
  )
    throw new Error("invalid Lean module name");
  const cwd = resolve(options.project);
  await runLake(cwd, lake, ["build", options.module]);
  return runLake(cwd, lake, [
    "env",
    exporter,
    options.module,
    ...(options.claims.length ? ["--", ...options.claims] : []),
  ]);
}

const LEAN_TOOLCHAIN = "leanprover/lean4:v4.36.0-rc1";

async function runLake(
  project: string,
  lake: string,
  args: string[],
): Promise<string> {
  const toolchain = Bun.file(join(project, "lean-toolchain"));
  if (await toolchain.exists()) {
    const requested = (await toolchain.text()).trim();
    if (![LEAN_TOOLCHAIN, "v4.36.0-rc1"].includes(requested))
      throw new Error(
        `ZKLean requires ${LEAN_TOOLCHAIN}; this project selects ${requested}`,
      );
  }
  const child = Bun.spawn([lake, ...args], {
    cwd: project,
    env: { ...process.env, ELAN_TOOLCHAIN: LEAN_TOOLCHAIN },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0)
    throw new Error(
      `Lake ${args[0]} failed:\n${`${stdout}\n${stderr}`.trim().slice(-4000)}`,
    );
  return stdout;
}
