/** Values authenticated by the pinned SP1 guest. */
export interface Specs {
  declarations: string;
  claims: string[];
}
export interface Certificate {
  format: "zklean/1";
  specs: Specs;
  axioms: string[];
  proof: string;
}
export interface Requirements {
  format: "httpv/requirements/1";
  specs: Specs;
  /** Required for a .lean sidecar; detects stale exported requirements. */
  sourceSha256?: string;
}
export interface PublicModel {
  format: "lean4/kernel/1";
  declarations: Record<string, Record<string, Record<string, unknown>>>;
  nodes: Record<string, Record<string, unknown>>;
}

/** This is trusted application configuration, never certificate-provided code. */
export interface ProofBackend {
  verify(certificate: Certificate): Promise<boolean>;
}
export type Status = "verified" | "incompatible" | "unknown";
export type Reason =
  | "valid" | "exact-match" | "derivation" | "requirements-not-met"
  | "invalid-certificate" | "forbidden-axiom" | "unavailable"
  | "missing-certificate" | "verifier-unavailable" | "requirements-unavailable"
  | "missing-derivation" | "invalid-derivation";
export interface VerificationResult {
  status: Status;
  reason: Reason;
  /** Identity of the complete certificate, including its proof and axiom list. */
  certificateId?: string;
  /** Identity of the canonical public formal model and certified claims. */
  modelId?: string;
  detail?: string;
}
export interface VerifyOptions { allowedAxioms: readonly string[] }
export interface CompatibilityOptions extends VerifyOptions {
  certificate: unknown;
  requirements: Requirements | string;
  derivation?: unknown;
  /** Exact comparison is decidable. Semantic checking requires a derivation. */
  mode?: "exact" | "implication";
}
export interface QueryOptions {
  method: string;
  signal?: AbortSignal;
  timeout?: number;
  /** HTTP is accepted only when explicitly enabled for local development. */
  allowInsecureHttp?: boolean;
}
export interface WatchOptions extends QueryOptions {
  url: string;
  requirements: Requirements | string;
  allowedAxioms?: readonly string[];
  interval: number;
  derivation?: unknown;
  mode?: "exact" | "implication";
  onChange(result: VerificationResult): void | Promise<void>;
  onError?(error: unknown): void;
}
export interface Monitor {
  stop(): void;
  refresh(): Promise<VerificationResult>;
  readonly current: VerificationResult | undefined;
}
export type Handler = (request: Request) => Response | Promise<Response>;
export interface ServeOptions {
  routes: Record<string, Certificate | string | (() => Certificate | Promise<Certificate>)>;
  fetch: Handler;
}
export interface ClientOptions {
  backend?: ProofBackend;
  fetch?: typeof globalThis.fetch;
  cacheSize?: number;
  maxResponseBytes?: number;
}
