import { certificateId, parseCertificate, statementId } from "./encoding.ts";
import { checkAxioms } from "./policy.ts";
import { groth16Backend } from "./groth16.ts";
import type {
  VerificationResult,
  VerifierOptions,
  VerifyOptions,
} from "./types.ts";

/** Local certificate verification has no HTTP or discovery dependency. */
export function createVerifier(options: VerifierOptions = {}) {
  const backend = options.backend ?? groth16Backend();
  // Keyed by the whole certificate, so every accepted certificate carries a
  // valid proof. Concurrent checks of one certificate share a single run.
  // Bounded: Groth16 proofs can be rerandomized into unlimited valid variants.
  const checks = new Map<string, Promise<boolean>>();

  async function verify(
    value: unknown,
    policy: VerifyOptions,
  ): Promise<VerificationResult> {
    let identity: { certificateId: string; statementId: string };
    let key: string;
    let check: () => Promise<boolean>;
    try {
      const certificate = parseCertificate(value);
      identity = {
        certificateId: certificateId(certificate),
        statementId: statementId(certificate),
      };
      const policyError = checkAxioms(certificate, policy);
      if (policyError)
        return { ...identity, status: "unknown", reason: policyError };
      key = `${backend.identity}\0${identity.certificateId}`;
      check = () => backend.verify(certificate);
    } catch (error) {
      return {
        status: "unknown",
        reason: "invalid-certificate",
        detail: String(error),
      };
    }
    let task = checks.get(key);
    if (!task) {
      task = check();
      checks.set(key, task);
      if (checks.size > 1024) checks.delete(checks.keys().next().value!);
    }
    try {
      if (await task)
        return { ...identity, status: "verified", reason: "valid" };
      checks.delete(key);
      return { ...identity, status: "unknown", reason: "invalid-certificate" };
    } catch (error) {
      checks.delete(key);
      return {
        ...identity,
        status: "unknown",
        reason: "verifier-unavailable",
        detail: String(error),
      };
    }
  }

  return { verify };
}
