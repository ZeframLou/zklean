import {
  Cache,
  MAX_CERTIFICATE_BYTES,
  canonical,
  certificateId,
  modelId,
  object,
  parseCertificate,
} from "./encoding.ts";
import { exactMatch, loadRequirements, validBridge } from "./compatibility.ts";
import { discoveryHandler, MEDIA_TYPE, methodName } from "./server.ts";
import type {
  Certificate,
  ClientOptions,
  CompatibilityOptions,
  Monitor,
  QueryOptions,
  ServeOptions,
  VerificationResult,
  VerifyOptions,
  WatchOptions,
} from "./types.ts";

export class DiscoveryError extends Error {
  constructor(
    readonly reason:
      | "unavailable"
      | "missing-certificate"
      | "invalid-certificate",
    message: string,
  ) {
    super(message);
  }
}

/** Instances scope all trust configuration and caches to one application. */
export function createHTTPV(options: ClientOptions = {}) {
  const transport = options.fetch ?? globalThis.fetch;
  const backend = options.backend;
  const verified = new Cache<boolean>(options.cacheSize ?? 128);
  const compatible = new Cache<boolean>(options.cacheSize ?? 128);
  const maxBytes = options.maxResponseBytes ?? MAX_CERTIFICATE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("invalid response limit");

  async function query(
    url: string,
    queryOptions: QueryOptions,
  ): Promise<Certificate> {
    const target = new URL(url);
    if (
      target.protocol !== "https:" &&
      !(target.protocol === "http:" && queryOptions.allowInsecureHttp)
    ) {
      throw new DiscoveryError(
        "unavailable",
        "HTTPV requires HTTPS (allowInsecureHttp is for development)",
      );
    }
    if (target.username || target.password || target.hash)
      throw new DiscoveryError("unavailable", "invalid discovery URL");
    const method = methodName(queryOptions.method);
    const timeout = queryOptions.timeout ?? 10_000;
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 0x7fffffff
    )
      throw new Error("invalid timeout");
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(queryOptions.signal ? [queryOptions.signal] : []),
    ]);
    try {
      const response = await transport(target, {
        method: "OPTIONS",
        headers: { Accept: MEDIA_TYPE, "Cache-Control": "no-cache" },
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (
        response.status === 404 ||
        response.status === 405 ||
        response.status === 501
      ) {
        await response.body?.cancel();
        throw new DiscoveryError(
          "missing-certificate",
          `discovery returned ${response.status}`,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new DiscoveryError(
          "unavailable",
          `discovery returned ${response.status}`,
        );
      }
      if (
        response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== MEDIA_TYPE
      ) {
        await response.body?.cancel();
        throw new DiscoveryError(
          "missing-certificate",
          "HTTPV media type missing",
        );
      }
      const reader = response.body?.getReader();
      if (!reader)
        throw new DiscoveryError("invalid-certificate", "empty discovery body");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes)
            throw new DiscoveryError(
              "invalid-certificate",
              "discovery response too large",
            );
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      let body: Record<string, unknown>;
      try {
        body = object(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          ),
        );
      } catch {
        throw new DiscoveryError(
          "invalid-certificate",
          "invalid discovery JSON",
        );
      }
      let certificates: Record<string, unknown>;
      try {
        certificates = object(body.certificates);
      } catch {
        throw new DiscoveryError(
          "invalid-certificate",
          "invalid certificates map",
        );
      }
      if (!Object.hasOwn(certificates, method))
        throw new DiscoveryError(
          "missing-certificate",
          `no certificate for ${method}`,
        );
      try {
        return parseCertificate(certificates[method]);
      } catch (error) {
        throw new DiscoveryError("invalid-certificate", String(error));
      }
    } catch (error) {
      if (error instanceof DiscoveryError) throw error;
      throw new DiscoveryError("unavailable", String(error));
    }
  }

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

  async function checkCompatibility(
    input: CompatibilityOptions,
  ): Promise<VerificationResult> {
    let certificate: Certificate;
    try {
      certificate = parseCertificate(input.certificate);
    } catch (error) {
      return {
        status: "unknown",
        reason: "invalid-certificate",
        detail: String(error),
      };
    }
    const result = await verify(certificate, input);
    if (result.status !== "verified") return result;
    let requirements;
    try {
      requirements = await loadRequirements(input.requirements);
    } catch (error) {
      return {
        ...result,
        status: "unknown",
        reason: "requirements-unavailable",
        detail: String(error),
      };
    }
    const key = canonical({
      remote: result.modelId,
      required: modelId(requirements.specs),
    });
    if (compatible.get(key) || exactMatch(certificate, requirements.specs)) {
      compatible.set(key, true);
      return { ...result, reason: "exact-match" };
    }
    if (input.mode === "exact")
      return { ...result, status: "incompatible", reason: "requirements-not-met" };
    if (input.derivation === undefined) {
      return { ...result, status: "unknown", reason: "missing-derivation" };
    }
    // A derivation may assume only client-permitted axioms and guarantees that
    // were independently authenticated in the remote certificate above.
    let bridge: Certificate;
    try {
      bridge = parseCertificate(input.derivation);
    } catch {
      return { ...result, status: "unknown", reason: "invalid-derivation" };
    }
    const bridgeResult = await verify(bridge, {
      allowedAxioms: [...input.allowedAxioms, ...certificate.specs.claims],
    });
    if (bridgeResult.status !== "verified")
      return { ...result, status: "unknown", reason: "invalid-derivation" };
    if (!validBridge(certificate, requirements.specs, bridge))
      return { ...result, status: "unknown", reason: "invalid-derivation" };
    // The certificate cache avoids repeated cryptography. The inexpensive context
    // comparison is repeated to keep derivation and axiom policies independent.
    return { ...result, reason: "derivation" };
  }

  function watch(input: WatchOptions): Monitor {
    if (
      !Number.isSafeInteger(input.interval) ||
      input.interval < 1 ||
      input.interval > 0x7fffffff
    )
      throw new Error("invalid polling interval");
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      ...(input.signal ? [input.signal] : []),
    ]);
    let current: VerificationResult | undefined;
    let inflight: Promise<VerificationResult> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = signal.aborted;
    let lastEvent: string | undefined;
    const onError = async (error: unknown) => {
      try {
        await input.onError?.(error);
      } catch {
        /* Application callback errors cannot stop polling. */
      }
    };
    const refresh = (): Promise<VerificationResult> => {
      if (inflight) return inflight;
      if (stopped)
        return Promise.resolve(
          current ?? { status: "unknown", reason: "unavailable" },
        );
      if (timer) clearTimeout(timer);
      let cycle!: Promise<VerificationResult>;
      cycle = (async () => {
        let result: VerificationResult;
        try {
          const certificate = await query(input.url, { ...input, signal });
          result = await checkCompatibility({
            ...input,
            certificate,
            allowedAxioms: input.allowedAxioms ?? [],
          });
        } catch (error) {
          result = {
            status: "unknown",
            reason:
              error instanceof DiscoveryError ? error.reason : "unavailable",
            detail: String(error),
          };
        }
        let changed = false;
        if (!stopped) {
          current = result;
          const event = canonical({
            status: result.status,
            reason: result.reason,
            certificateId: result.certificateId ?? null,
            modelId: result.modelId ?? null,
          });
          if (event !== lastEvent) {
            lastEvent = event;
            changed = true;
          }
        }
        // Release the network/check slot before application code runs. A callback
        // may safely request one immediate follow-up refresh.
        if (inflight === cycle) inflight = undefined;
        if (changed)
          try {
            await input.onChange(structuredClone(result));
          } catch (error) {
            await onError(error);
          }
        return result;
      })().finally(() => {
        if (inflight === cycle) inflight = undefined;
        if (!stopped) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            void refresh();
          }, input.interval);
        }
      });
      inflight = cycle;
      return inflight;
    };
    const stop = () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    signal.addEventListener("abort", stop, { once: true });
    queueMicrotask(() => {
      if (!stopped) void refresh();
    });
    return {
      stop,
      refresh,
      get current() {
        return current && structuredClone(current);
      },
    };
  }

  return {
    query,
    verify,
    checkCompatibility,
    watch,
    serve: (input: ServeOptions) => ({ fetch: discoveryHandler(input) }),
  };
}
export const HTTPV = createHTTPV();
