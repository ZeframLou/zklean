import { Cache, certificateId, modelId, parseCertificate } from "./encoding.ts";
import { checkAxioms } from "./policy.ts";
import { groth16Backend } from "./groth16.ts";
import type {
  Certificate,
  VerificationResult,
  VerifierOptions,
  VerifyOptions,
} from "./types.ts";

/** Local certificate verification has no HTTP or discovery dependency. */
export function createVerifier(options: VerifierOptions = {}) {
  const backend = options.backend ?? groth16Backend();
  const verified = new Cache<boolean>(options.cacheSize ?? 128);
  const pending = new Map<string, Promise<boolean>>();
  const limit = options.maxConcurrency ?? 2;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128)
    throw new Error("invalid verification concurrency");
  let active = 0;
  const waiters: (() => void)[] = [];
  const execute = async (certificate: Certificate): Promise<boolean> => {
    if (active >= limit)
      await new Promise<void>((resolve) => waiters.push(resolve));
    else active++;
    try {
      return await backend!.verify(certificate);
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active--;
    }
  };

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
    const policyError = checkAxioms(certificate, policy);
    if (policyError)
      return { ...identity, status: "unknown", reason: policyError };
    try {
      const cacheKey = `${backend.identity}\0${identity.certificateId}`;
      if (!verified.get(cacheKey)) {
        let task = pending.get(cacheKey);
        if (!task) {
          if (pending.size >= limit * 8)
            return { ...identity, status: "unknown", reason: "verifier-busy" };
          task = Promise.resolve().then(() => execute(certificate));
          pending.set(cacheKey, task);
          void task.finally(() => pending.delete(cacheKey)).catch(() => {});
        }
        if (!(await task))
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
