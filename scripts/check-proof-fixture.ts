import { resolve } from "node:path";
import { runNative } from "../src/native.ts";

const elfPath = resolve(process.argv[2] ?? "");
if (!process.argv[2])
  throw new Error("usage: check-proof-fixture.ts GUEST_ELF");
const binary = resolve(process.argv[3] ?? "target/release/zklean-native");
const actual = (await runNative(binary, "identity", { elfPath })) as Record<
  string,
  string
>;
const expected = (await Bun.file(
  resolve(import.meta.dir, "../tests/fixtures/identity.verifier.json"),
).json()) as Record<string, string>;
for (const key of ["elfSha256", "verifierKey"])
  if (actual[key] !== expected[key])
    throw new Error(
      `Groth16 proof fixture belongs to a different guest (${key})`,
    );
console.log("Groth16 proof fixture matches the current guest.");
