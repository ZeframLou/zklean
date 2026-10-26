import { expect, test } from "bun:test";
import { input } from "./helpers.ts";
import { runNative } from "../src/native.ts";
import { findTools } from "../src/tooling.ts";

// A dedicated CI job builds the real ELF with cargo-prove and zklean-native
// with the execute feature. No mock VM is used.
const elfPath = process.env.ZKLEAN_GUEST_ELF;
const binary = elfPath ? (await findTools()).binary : "";

// Every accepted fixture: execute itself requires the guest's public values to
// equal the native commitment, so the two checkers agree on each statement.
const accepted: [string, string[]][] = [
  ["identity", ["Demo.identity"]],
  ["v1", ["Inventory.reservation_safe"]],
  ["composition", ["Pipeline.compose", "Pipeline.weaken"]],
  ["axioms", ["Inventory.assumed_safe"]],
  ["axiom-spoof", ["Spoof.everything"]],
  ["mutual", ["Shapes.even_zero", "Shapes.leaf_eq"]],
  ["mutual-variant", ["Shapes.even_zero", "Shapes.leaf_eq"]],
  ["mutual-swapped", ["Shapes.even_zero", "Shapes.leaf_eq"]],
  ["chain", ["Chain.top"]],
  ["deep", ["Deep.f_ok"]],
];
for (const [fixture, claims] of accepted)
  test.skipIf(!elfPath)(
    `SP1 and native checking commit the same statement for ${fixture}`,
    async () => {
      const request = await input(fixture, claims);
      const result = (await runNative(binary, "execute", {
        elfPath,
        input: request,
      })) as { cycles: number; statement: unknown };
      expect(result.cycles).toBeGreaterThan(0);
      expect(result.statement).toEqual(
        await runNative(binary, "check", request),
      );
    },
    300_000,
  );

test.skipIf(!elfPath)(
  "the real SP1 guest rejects invalid proofs, ambiguous exports, kernel spoofs and unproved claims",
  async () => {
    const invalid = await input("identity", ["Demo.identity"]);
    invalid.export = invalid.export.replace('"value":6', '"value":0');
    await expect(
      runNative(binary, "execute", { elfPath, input: invalid }),
    ).rejects.toThrow("guest execution failed");
    const ambiguous = await input("identity", ["Demo.identity"]);
    ambiguous.export = ambiguous.export.replace(
      '"body":3',
      '"body":3,"body":1',
    );
    await expect(
      runNative(binary, "execute", { elfPath, input: ambiguous }),
    ).rejects.toThrow("guest execution failed");
    for (const spoof of [
      await input("kernel-spoof", ["Attack.claim"]),
      await input("v1-spec"),
    ])
      await expect(
        runNative(binary, "execute", { elfPath, input: spoof }),
      ).rejects.toThrow("guest execution failed");
  },
  300_000,
);
