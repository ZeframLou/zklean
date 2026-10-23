/** ZKLean's standalone API: proving and local verification, without HTTPV. */
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
  ProofBackend,
  VerifierOptions,
  VerifyOptions,
  VerificationResult,
} from "./types.ts";
