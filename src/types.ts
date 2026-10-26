/** Lean names mapped to declaration identities (64 lowercase hex digits). */
export type Identified = Readonly<Record<string, string>>;

/** Values authenticated by the pinned SP1 guest. */
export interface Statement {
  format: "zklean/1";
  /** Proved propositions. */
  claims: Identified;
  /** Every axiom the proofs use. */
  axioms: Identified;
}
export interface Certificate extends Statement {
  /** Groth16 proof that the pinned checker accepted the statement. */
  proof: string;
  /** https URL of a lean4export file containing every claim and axiom.
   * Untrusted: it must reproduce the certified identities. */
  source: string;
}
export interface Requirements {
  format: "zklean/requirements/1";
  claims: Identified;
}

/** This is trusted application configuration, never certificate-provided code. */
export interface ProofBackend {
  verify(certificate: Certificate): Promise<boolean>;
}
export type Status = "verified" | "unknown";
export type Reason =
  | "valid"
  | "invalid-certificate"
  | "forbidden-axiom"
  | "axiom-mismatch"
  | "verifier-unavailable";
/** A verified result carries exactly the claims and axioms that were proved. */
export type VerificationResult =
  | {
      status: "verified";
      reason: "valid";
      /** Identity of the authenticated statement. */
      statementId: string;
      claims: Identified;
      axioms: Identified;
    }
  | {
      status: "unknown";
      reason: Exclude<Reason, "valid">;
      statementId?: string;
      detail?: string;
    };
export interface Policy {
  /** Permitted axioms by name and identity; see `standardAxioms`. */
  axioms: Identified;
}
export interface VerifierOptions {
  backend?: ProofBackend;
}
