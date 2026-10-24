/// <reference path="./assets.d.ts" />
import profile from "./guest.json";
import { decodeBase64, statementCommitment } from "./encoding.ts";
import { groth16Pool } from "./groth16-pool.ts";
import type { ProofBackend } from "./types.ts";

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
      const input = new Uint8Array(324);
      input.set(proof);
      input.set(Buffer.from(statementCommitment(certificate), "hex"), 260);
      input.set(Buffer.from(verifierKey.slice(2), "hex"), 292);
      return groth16Pool.verify(input);
    },
  };
}
