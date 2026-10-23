import wasmPath from "./verifier.wasm" with { type: "file" };
import profile from "./guest.json";
import { decodeBase64, statementCommitment } from "./encoding.ts";
import type { ProofBackend } from "./types.ts";

let module: Promise<WebAssembly.Module> | undefined;

/** The checker key is trusted application configuration, never certificate data. */
export function groth16Backend(
  verifierKey = profile.verifierKey,
): ProofBackend {
  if (!/^0x[0-9a-f]{64}$/.test(verifierKey))
    throw new Error("expected a pinned SP1 BN254 guest key");
  return {
    identity: `sp1:5.2.4:groth16:${verifierKey}`,
    async verify(certificate) {
      const proof = decodeBase64(certificate.proof);
      if (proof.length !== 260) return false;
      module ??= Bun.file(wasmPath).arrayBuffer().then(WebAssembly.compile);
      const instance = await WebAssembly.instantiate(await module);
      const exports = instance.exports as {
        memory: WebAssembly.Memory;
        input_buffer(): number;
        verify(): number;
      };
      const input = new Uint8Array(
        exports.memory.buffer,
        exports.input_buffer(),
        324,
      );
      input.set(proof);
      input.set(Buffer.from(statementCommitment(certificate), "hex"), 260);
      input.set(Buffer.from(verifierKey.slice(2), "hex"), 292);
      // Upstream rejects invalid curve encodings; traps also fail closed.
      try {
        return exports.verify() === 1;
      } catch {
        return false;
      }
    },
  };
}
