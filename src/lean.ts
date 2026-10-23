import { delimiter, join, resolve } from "node:path";

export const LEAN_TOOLCHAIN = "leanprover/lean4:v4.36.0-rc1";

export async function runLake(
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

/** Ask Lake for the configured source search path, including each library's srcDir. */
export async function resolveLeanSource(
  project: string,
  module: string,
  lake: string,
): Promise<string> {
  if (!/^[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*$/.test(module))
    throw new Error("invalid Lean module name");
  const paths = await runLake(project, lake, [
    "env",
    "printenv",
    "LEAN_SRC_PATH",
  ]);
  for (const path of paths.trim().split(delimiter)) {
    const candidate = resolve(
      project,
      path,
      `${module.replaceAll(".", "/")}.lean`,
    );
    if (await Bun.file(candidate).exists()) return candidate;
  }
  throw new Error(`Lake could not resolve the source for ${module}`);
}
