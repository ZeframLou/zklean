/// <reference path="./assets.d.ts" />
import workerPath from "./groth16.worker.js" with { type: "file" };
import wasmPath from "./verifier.wasm" with { type: "file" };
import { Worker } from "node:worker_threads";
import profile from "./guest.json";
import {
  PROOF_BYTES,
  SP1_VERSION,
  decodeBase64,
  statementId,
} from "./encoding.ts";
import type { ProofBackend } from "./types.ts";

/** The checker key is trusted application configuration, never certificate data. */
export function groth16Backend(
  verifierKey = profile.verifierKey,
): ProofBackend {
  if (!/^0x[0-9a-f]{64}$/.test(verifierKey))
    throw new Error("expected a pinned SP1 BN254 guest key");
  return {
    identity: `sp1:${SP1_VERSION}:groth16:${verifierKey}`,
    async verify(certificate) {
      const proof = decodeBase64(certificate.proof);
      if (proof.length !== PROOF_BYTES) return false;
      // The WASM verifier's input: proof, statement digest, verifier key.
      const input = new Uint8Array(PROOF_BYTES + 64);
      input.set(proof);
      input.set(Buffer.from(statementId(certificate), "hex"), PROOF_BYTES);
      input.set(Buffer.from(verifierKey.slice(2), "hex"), PROOF_BYTES + 32);
      return verifyGroth16(input);
    },
  };
}

/** One background worker runs pairing checks off the event loop, one at a time.
 * A worker that traps or fails is replaced before the next check. */
let worker: Worker | undefined;
let wasm: Promise<Uint8Array> | undefined;
let queue: Promise<unknown> = Promise.resolve();

function run(input: Uint8Array): Promise<boolean> {
  // A failed load is retried on the next check rather than cached.
  wasm ??= Bun.file(wasmPath)
    .bytes()
    .catch((error) => {
      wasm = undefined;
      throw error;
    });
  return wasm.then(
    (bytes) =>
      new Promise<boolean>((resolve, reject) => {
        const fresh = !worker;
        const current = (worker ??= new Worker(workerPath, {
          name: "zklean-groth16",
        }));
        const done = (error?: unknown, valid = false, reset = false) => {
          current.off("message", onMessage);
          current.off("error", done);
          current.off("exit", onExit);
          current.unref();
          if (error !== undefined || reset) {
            if (worker === current) worker = undefined;
            void current.terminate();
          }
          if (error !== undefined) reject(error);
          else resolve(valid);
        };
        const onMessage = (data: {
          valid?: boolean;
          reset?: boolean;
          error?: string;
        }) =>
          typeof data?.valid === "boolean"
            ? done(undefined, data.valid, data.reset)
            : done(new Error(data?.error ?? "invalid Groth16 worker reply"));
        const onExit = () => done(new Error("Groth16 worker exited"));
        current.on("message", onMessage);
        current.once("error", done);
        current.once("exit", onExit);
        current.ref();
        current.postMessage({ input, ...(fresh ? { wasm: bytes } : {}) });
      }),
  );
}

function verifyGroth16(input: Uint8Array): Promise<boolean> {
  const result = queue.then(() => run(input));
  queue = result.catch(() => {});
  return result;
}
