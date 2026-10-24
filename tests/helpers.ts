import { resolve } from "node:path";
import { inventoryAxioms } from "../examples/inventory.ts";
import { runNative } from "../src/native.ts";
import type { Certificate } from "../src/types.ts";

export { inventoryAxioms };

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
  allowedAxioms: string[] = inventoryAxioms,
) {
  return {
    export: await Bun.file(
      resolve(root, `tests/fixtures/${module}.ndjson`),
    ).text(),
    claims,
    allowedAxioms,
  };
}
export async function checked(
  module: string,
  claims?: string[],
  axioms?: string[],
) {
  await buildNative();
  return (await runNative(
    binary,
    "check",
    await input(module, claims, axioms),
  )) as Omit<Certificate, "proof">;
}
