import { certificateId, parseCertificate, statementId } from "./encoding.ts";
import { checkAxioms, rejectedAxioms } from "./policy.ts";
import { groth16Backend } from "./groth16.ts";
import type { VerificationResult, VerifierOptions, Policy } from "./types.ts";

/** Local certificate verification has no HTTP or discovery dependency. */
export function createVerifier(options: VerifierOptions = {}) {
  const backend = options.backend ?? groth16Backend();
  // Keyed by the whole certificate, so every accepted certificate carries a
  // valid proof. Concurrent checks of one certificate share a single run.
  // Bounded: Groth16 proofs can be rerandomized into unlimited valid variants.
  const checks = new Map<string, Promise<boolean>>();

  async function verify(
    value: unknown,
    policy: Policy,
  ): Promise<VerificationResult> {
    // Parsing copies the certificate, so the caller cannot change what is
    // verified, and the result reports exactly what was.
    let certificate;
    try {
      certificate = parseCertificate(value);
    } catch (error) {
      return {
        status: "unknown",
        reason: "invalid-certificate",
        detail: String(error),
      };
    }
    const id = statementId(certificate);
    const policyError = checkAxioms(certificate, policy);
    if (policyError)
      return {
        statementId: id,
        status: "unknown",
        reason: policyError,
        detail: `not permitted: ${rejectedAxioms(certificate, policy)
          .map(([name]) => name)
          .join(", ")}`,
      };
    const key = certificateId(certificate);
    let task = checks.get(key);
    if (!task) {
      task = backend.verify(certificate);
      checks.set(key, task);
      if (checks.size > 1024) checks.delete(checks.keys().next().value!);
    }
    try {
      if (await task)
        return {
          statementId: id,
          status: "verified",
          reason: "valid",
          claims: certificate.claims,
          axioms: certificate.axioms,
        };
      checks.delete(key);
      return {
        statementId: id,
        status: "unknown",
        reason: "invalid-certificate",
      };
    } catch (error) {
      checks.delete(key);
      return {
        statementId: id,
        status: "unknown",
        reason: "verifier-unavailable",
        detail: String(error),
      };
    }
  }

  return { verify };
}
