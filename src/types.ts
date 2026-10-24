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
  format: "zklean/requirements/1";
  specs: Specs;
}
export interface PublicModel {
  format: "lean4/kernel/2";
  declarations: Record<string, Record<string, Record<string, unknown>>>;
  nodes: Record<string, Record<string, unknown>>;
}

/** This is trusted application configuration, never certificate-provided code. */
export interface ProofBackend {
  /** Stable identity of the trusted verifier profile; isolates cached results. */
  readonly identity: string;
  verify(certificate: Certificate): Promise<boolean>;
}
export type Status = "verified" | "unknown";
export type Reason =
  | "valid"
  | "invalid-certificate"
  | "forbidden-axiom"
  | "unpinned-axiom"
  | "axiom-mismatch"
  | "verifier-unavailable";
export interface VerificationResult {
  status: Status;
  reason: Reason;
  /** Identity of the complete certificate, including its proof and axiom list. */
  certificateId?: string;
  /** Identity of the canonical public formal model and certified claims. */
  modelId?: string;
  detail?: string;
}
export interface VerifyOptions {
  allowedAxioms: readonly string[];
  /** Fingerprints of reviewed custom axioms and their complete resolved context. */
  axiomPins?: Readonly<Record<string, string>>;
}
export interface VerifierOptions {
  backend?: ProofBackend;
}
