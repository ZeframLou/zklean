/** Regenerate the pinned identities of Lean's own definitions at the pinned
 * toolchain: the constants the checker computes with by name, then the
 * standard axioms. */
import { resolve } from "node:path";
import { runNative } from "../src/native.ts";
import { exportModule, findTools } from "../src/tooling.ts";

// A native test requires these names to equal the core's KERNEL list, so a
// new kernel constant is first added to kernel.json by name.
const kernel = Object.keys(
  await Bun.file("crates/core/src/kernel.json").json(),
);
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

// Both steps run the binary built here, from the current pins.
const native = resolve("target/release/zklean-native");
const build = () => {
  const child = Bun.spawnSync(
    ["cargo", "build", "--release", "--locked", "-p", "zklean-native"],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (child.exitCode !== 0) throw new Error("native build failed");
};

build();
await write(
  "crates/core/src/kernel.json",
  await runNative(native, "kernel", { export: await exported(kernel) }),
);
// The pins are compiled in, and every later check enforces them.
build();
const { axioms } = (await runNative(native, "check", {
  export: await exported(claims),
  claims,
})) as { axioms: Record<string, string> };
await write("src/axioms.json", axioms);
