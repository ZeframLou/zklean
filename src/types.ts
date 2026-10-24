/** Lean names mapped to declaration identities (64 lowercase hex digits). */
export type Identified = Readonly<Record<string, string>>;

/** Values authenticated by the pinned SP1 guest. */
export interface Statement {
  format: "zklean/1";
  /** Proved propositions. */
  claims: Identified;
  /** Non-proof declarations the claims state facts about, such as an operation. */
  definitions: Identified;
  /** Every axiom the proofs use. */
  axioms: Identified;
}
export interface Certificate extends Statement {
  proof: string;
}
export interface Requirements {
  format: "zklean/requirements/1";
  claims: Identified;
  definitions: Identified;
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
  | "axiom-mismatch"
  | "verifier-unavailable";
export interface VerificationResult {
  status: Status;
  reason: Reason;
  /** Identity of the complete certificate, including its proof. */
  certificateId?: string;
  /** Identity of the authenticated statement. */
  statementId?: string;
  detail?: string;
}
export interface VerifyOptions {
  /** Permitted axioms by name and identity; see `standardAxioms`. */
  axioms: Identified;
}
export interface VerifierOptions {
  backend?: ProofBackend;
}
