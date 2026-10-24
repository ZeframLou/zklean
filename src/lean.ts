import { join } from "node:path";

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
