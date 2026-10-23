import { generateKeyPairSync, sign, verify } from "node:crypto";
import { resolve } from "node:path";
import { canonical, encodeBase64, statement } from "../src/encoding.ts";
import { inventoryAxioms } from "../examples/inventory.ts";
import { runNative } from "../src/native.ts";
import type { Certificate, ProofBackend, Requirements } from "../src/types.ts";

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

/** Only E2E transport tests use signatures instead of STARK proofs. Each signed
 * statement is first checked by the real Nanoda binary. This backend is never
 * exported by the library and does not exercise SP1 cryptographic soundness. */
export function testAuthority() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  let calls = 0;
  const backend: ProofBackend = {
    identity: `test:${publicKey.export({ type: "spki", format: "der" }).toString("hex")}`,
    async verify(certificate) {
      calls++;
      return verify(
        null,
        Buffer.from(canonical(statement(certificate))),
        publicKey,
        Buffer.from(certificate.proof.slice(7), "base64"),
      );
    },
  };
  return {
    backend,
    get calls() {
      return calls;
    },
    async issue(
      module: string,
      claims?: string[],
      axioms?: string[],
    ): Promise<Certificate> {
      const value = await checked(module, claims, axioms);
      return {
        ...value,
        proof: encodeBase64(
          sign(null, Buffer.from(canonical(value)), privateKey),
        ),
      };
    },
  };
}
export async function requirements(): Promise<Requirements> {
  await buildNative();
  return (await runNative(
    binary,
    "requirements",
    await input("requirements", ["Client.stock_conserved"]),
  )) as Requirements;
}
