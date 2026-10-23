import { Cache, certificateId, modelId, parseCertificate } from "./encoding.ts";
import type {
  Certificate,
  VerificationResult,
  VerifierOptions,
  VerifyOptions,
} from "./types.ts";

/** Local certificate verification has no HTTP or discovery dependency. */
export function createVerifier(options: VerifierOptions = {}) {
  const backend = options.backend;
  const verified = new Cache<boolean>(options.cacheSize ?? 128);

  async function verify(
    value: unknown,
    policy: VerifyOptions,
  ): Promise<VerificationResult> {
    let certificate: Certificate;
    try {
      certificate = parseCertificate(value);
    } catch (error) {
      return {
        status: "unknown",
        reason: "invalid-certificate",
        detail: String(error),
      };
    }
    const identity = {
      certificateId: certificateId(certificate),
      modelId: modelId(certificate.specs),
    };
    // Always apply the caller's current policy, including on a cache hit.
    if (
      !Array.isArray(policy.allowedAxioms) ||
      certificate.axioms.some((a) => !policy.allowedAxioms.includes(a))
    ) {
      return { ...identity, status: "unknown", reason: "forbidden-axiom" };
    }
    if (!backend)
      return { ...identity, status: "unknown", reason: "verifier-unavailable" };
    try {
      const cacheKey = `${backend.identity}\0${identity.certificateId}`;
      if (!verified.get(cacheKey)) {
        if (!(await backend.verify(certificate)))
          return {
            ...identity,
            status: "unknown",
            reason: "invalid-certificate",
          };
        verified.set(cacheKey, true);
      }
      return { ...identity, status: "verified", reason: "valid" };
    } catch (error) {
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
