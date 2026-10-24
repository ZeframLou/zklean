import { beforeAll, expect, test } from "bun:test";
import { binary, input, root } from "./helpers.ts";
import { runNative } from "../src/native.ts";

const elfPath = process.env.ZKLEAN_GUEST_ELF;
// Dedicated CI job builds this real ELF with cargo-prove. No mock VM is used.
beforeAll(async () => {
  if (!elfPath) return;
  const child = Bun.spawn(
    [
      "cargo",
      "build",
      "--release",
      "--locked",
      "-p",
      "zklean-native",
      "--features",
      "execute",
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0)
    throw new Error("guest executor build failed");
}, 300_000);

test.skipIf(!elfPath)(
  "SP1 executes Nanoda and commits the same model as native checking",
  async () => {
    const result = (await runNative(binary, "execute", {
      elfPath,
      input: await input("v1"),
    })) as { cycles: number; statement: { axioms: string[] } };
    expect(result.cycles).toBeGreaterThan(0);
    expect(result.statement.axioms).toEqual(["propext"]);
  },
  300_000,
);

test.skipIf(!elfPath)(
  "the real SP1 guest rejects invalid proofs and forbidden axioms",
  async () => {
    const invalid = await input("identity", ["Demo.identity"]);
    invalid.export = invalid.export.replace('"value":6', '"value":0');
    await expect(
      runNative(binary, "execute", { elfPath, input: invalid }),
    ).rejects.toThrow("guest execution failed");
    await expect(
      runNative(binary, "execute", {
        elfPath,
        input: await input("axioms", ["Inventory.assumed_safe"]),
      }),
    ).rejects.toThrow("guest execution failed");
    const ambiguous = await input("identity", ["Demo.identity"]);
    ambiguous.export = ambiguous.export.replace(
      '"body":3',
      '"body":3,"body":1',
    );
    await expect(
      runNative(binary, "execute", { elfPath, input: ambiguous }),
    ).rejects.toThrow("guest execution failed");
  },
  300_000,
);
