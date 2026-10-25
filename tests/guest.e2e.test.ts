import { expect, test } from "bun:test";
import { input } from "./helpers.ts";
import { runNative } from "../src/native.ts";
import { findTools } from "../src/tooling.ts";

// A dedicated CI job builds the real ELF with cargo-prove and zklean-native
// with the execute feature. No mock VM is used.
const elfPath = process.env.ZKLEAN_GUEST_ELF;
const binary = elfPath ? (await findTools()).binary : "";

test.skipIf(!elfPath)(
  "SP1 executes Nanoda and commits the same statement as native checking",
  async () => {
    const request = await input("v1");
    const result = (await runNative(binary, "execute", {
      elfPath,
      input: request,
    })) as { cycles: number; statement: unknown };
    expect(result.cycles).toBeGreaterThan(0);
    expect(result.statement).toEqual(await runNative(binary, "check", request));
  },
  300_000,
);

test.skipIf(!elfPath)(
  "the real SP1 guest rejects invalid proofs and ambiguous exports",
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
  },
  300_000,
);
