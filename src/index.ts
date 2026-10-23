/** Public API for local Lean model handling, proving, and verification. */
export { createVerifier } from "./verifier.ts";
export { nativeBackend, runNative } from "./native.ts";
export {
  parseCertificate,
  readModel,
  certificateId,
  modelId,
} from "./encoding.ts";
export type { NativeOptions, ProveInput } from "./native.ts";
export type {
  Certificate,
  Specs,
  Requirements,
  SourceManifest,
  PublicModel,
  ProofBackend,
  VerifierOptions,
  VerifyOptions,
  VerificationResult,
} from "./types.ts";
export { createSourceManifest, loadRequirements } from "./requirements.ts";
export {
  declarationIdentity,
  contextMatches,
  publicContext,
  requirementsFor,
} from "./context.ts";
export { checkAxioms } from "./policy.ts";
