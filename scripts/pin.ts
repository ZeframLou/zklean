/** Regenerate the pinned identities of Lean's own definitions at the pinned
 * toolchain: the constants the checker computes with by name, then the
 * standard axioms. */
import { resolve } from "node:path";
import { runNative } from "../src/index.ts";
import { exportModule, findTools } from "../src/tooling.ts";

const kernel = [
  "eagerReduce",
  "Quot",
  "Quot.mk",
  "Quot.lift",
  "Quot.ind",
  "String",
  "String.ofList",
  "Nat",
  "Nat.zero",
  "Nat.succ",
  "Nat.add",
  "Nat.sub",
  "Nat.mul",
  "Nat.pow",
  "Nat.mod",
  "Nat.div",
  "Nat.beq",
  "Nat.ble",
  "Nat.gcd",
  "Nat.xor",
  "Nat.land",
  "Nat.lor",
  "Nat.shiftLeft",
  "Nat.shiftRight",
  "Bool.true",
  "Bool.false",
  "Char",
  "Char.ofNat",
  "List",
  "List.nil",
  "List.cons",
];
const claims = [
  "AxiomPolicy.ext",
  "AxiomPolicy.choice_used",
  "AxiomPolicy.quotient",
];
const tools = await findTools();
const write = (path: string, value: unknown) =>
  Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
const exported = (names: string[]) =>
  exportModule({
    project: resolve("examples/lean"),
    module: "AxiomPolicy",
    claims: names,
    tools,
  });

await write(
  "crates/core/src/kernel.json",
  await runNative(tools.binary, "kernel", {
    export: await exported(kernel),
  }),
);
// The pins are compiled in, and every later check enforces them.
const build = Bun.spawnSync(
  ["cargo", "build", "--release", "--locked", "-p", "zklean-native"],
  { stdout: "inherit", stderr: "inherit" },
);
if (build.exitCode !== 0) throw new Error("native build failed");
const { axioms } = (await runNative(tools.binary, "check", {
  export: await exported(claims),
  claims,
})) as { axioms: Record<string, string> };
await write("src/axioms.json", axioms);
