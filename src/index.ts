/** Public API for local Lean model handling, proving, and verification. */
export { createVerifier } from "./verifier.ts";
export { nativeBackend, runNative } from "./native.ts";
export {
  parseCertificate,
  parseStatement,
  certificateId,
  statementId,
} from "./encoding.ts";
export type { NativeOptions, ProveInput } from "./native.ts";
export type {
  Certificate,
  Statement,
  Identified,
  Requirements,
  ProofBackend,
  VerifierOptions,
  VerifyOptions,
  VerificationResult,
} from "./types.ts";
export { loadRequirements } from "./requirements.ts";
export { checkAxioms, standardAxioms } from "./policy.ts";
export { groth16Backend } from "./groth16.ts";
