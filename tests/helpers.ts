import { resolve } from "node:path";
import { runNative } from "../src/native.ts";
import type { Statement } from "../src/types.ts";

export const root = resolve(import.meta.dir, "..");
export const binary = resolve(root, "target/release/zklean-native");
let built: Promise<void> | undefined;
export function buildNative(): Promise<void> {
  return (built ??= (async () => {
    const child = Bun.spawn(
      ["cargo", "build", "--release", "--locked", "-p", "zklean-native"],
      { cwd: root, stderr: "inherit", stdout: "inherit" },
    );
    if ((await child.exited) !== 0) throw new Error("native build failed");
  })());
}
export async function input(
  module: string,
  claims = ["Inventory.reservation_safe"],
) {
  return {
    export: await Bun.file(
      resolve(root, `tests/fixtures/${module}.ndjson`),
    ).text(),
    claims,
  };
}
export async function checked(module: string, claims?: string[]) {
  await buildNative();
  return (await runNative(
    binary,
    "check",
    await input(module, claims),
  )) as Statement;
}
