import { resolve } from "node:path";
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
  ["quoted", ["«rate.limit».pos"]],
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
      // execute requires the guest's public value to equal the native
      // commitment, so success means the two checkers agree.
      const result = (await runNative(binary, "execute", {
        elfPath,
        input: request,
      })) as { cycles: number };
      expect(result.cycles).toBeGreaterThan(0);
    },
    300_000,
  );

test.skipIf(!elfPath)(
  "SP1 accepts Lean library theorems by their pinned membership",
  async () => {
    const request = await input("percent", ["Progress.percent_le_100"]);
    const prepared = (await runNative(binary, "prepare", {
      ...request,
      library: await Bun.file(
        resolve(import.meta.dir, "../library/lean-4.35.0.ndjson"),
      ).text(),
    })) as object;
    const result = (await runNative(binary, "execute", {
      elfPath,
      input: { ...request, ...prepared },
    })) as { statement: unknown };
    expect(result.statement).toEqual(await runNative(binary, "check", request));
  },
  300_000,
);

test.skipIf(!elfPath)(
  "the real SP1 guest rejects what native checking rejects, for the same reason",
  async () => {
    const invalid = await input("identity", ["Demo.identity"]);
    invalid.export = invalid.export.replace('"value":6', '"value":0');
    const ambiguous = await input("identity", ["Demo.identity"]);
    ambiguous.export = ambiguous.export.replace(
      '"body":3',
      '"body":3,"body":1',
    );
    const cases: [typeof invalid, string][] = [
      [invalid, "self.def_eq(u, v)"],
      [ambiguous, "duplicate field `body`"],
      [
        await input("kernel-spoof", ["Attack.claim"]),
        "Nat.gcd differs from Lean's definition",
      ],
      [await input("v1-spec"), "claim must be a theorem of a proposition"],
    ];
    for (const [request, reason] of cases) {
      await expect(runNative(binary, "check", request)).rejects.toThrow(reason);
      await expect(
        runNative(binary, "execute", { elfPath, input: request }),
      ).rejects.toThrow("guest execution failed");
    }
  },
  300_000,
);
