/// <reference path="./assets.d.ts" />
import workerPath from "./groth16.worker.js" with { type: "file" };
import wasmPath from "./verifier.wasm" with { type: "file" };
import { Worker } from "node:worker_threads";
import { VerifierBusyError } from "./backend-errors.ts";

interface Job {
  input: Uint8Array;
  resolve(value: boolean): void;
  reject(error: unknown): void;
}
interface Slot {
  worker: Worker;
  initialized: boolean;
  retiring: boolean;
  job?: Job;
  timer?: ReturnType<typeof setTimeout>;
}

/** Shared across SDK verifier instances: at most two workers and sixteen jobs.
 * Idle workers do not keep a CLI/application alive. A failed or stuck worker
 * is discarded, so it cannot permanently consume the verification budget. */
class Groth16Pool {
  private readonly workers = new Set<Slot>();
  private readonly idle: Slot[] = [];
  private readonly queue: Job[] = [];
  private wasm: Promise<Uint8Array> | undefined;

  verify(input: Uint8Array): Promise<boolean> {
    if (this.queue.length + this.workers.size - this.idle.length >= 16)
      return Promise.reject(
        new VerifierBusyError("Groth16 worker pool is busy"),
      );
    return new Promise((resolve, reject) => {
      this.queue.push({ input, resolve, reject });
      this.dispatch();
    });
  }

  private discard(slot: Slot, error: unknown): void {
    if (!this.workers.has(slot) || slot.retiring) return;
    const index = this.idle.indexOf(slot);
    if (index >= 0) this.idle.splice(index, 1);
    clearTimeout(slot.timer);
    slot.job?.reject(error);
    delete slot.job;
    this.retire(slot);
  }

  private retire(slot: Slot): void {
    slot.retiring = true;
    // Count retiring threads against the budget until termination completes.
    void Promise.resolve()
      .then(() => slot.worker.terminate())
      .catch(() => {})
      .finally(() => {
        this.workers.delete(slot);
        this.dispatch();
      });
  }

  private create(): Slot {
    const slot: Slot = {
      worker: new Worker(workerPath, { name: "zklean-groth16" }),
      initialized: false,
      retiring: false,
    };
    this.workers.add(slot);
    slot.worker.on("message", (data) => {
      if (!this.workers.has(slot) || slot.retiring || !slot.job) return;
      if (typeof data?.valid !== "boolean") {
        this.discard(
          slot,
          new Error(data?.error ?? "invalid Groth16 worker reply"),
        );
        return;
      }
      clearTimeout(slot.timer);
      const job = slot.job;
      delete slot.job;
      if (data.reset) this.retire(slot);
      else {
        slot.worker.unref();
        this.idle.push(slot);
      }
      job.resolve(data.valid);
      this.dispatch();
    });
    slot.worker.on("error", (error) => this.discard(slot, error));
    slot.worker.on("exit", () =>
      this.discard(slot, new Error("Groth16 worker exited")),
    );
    return slot;
  }

  private dispatch(): void {
    while (this.queue.length && (this.idle.length || this.workers.size < 2)) {
      let slot: Slot;
      try {
        slot = this.idle.pop() ?? this.create();
      } catch (error) {
        this.queue.shift()!.reject(error);
        continue;
      }
      slot.job = this.queue.shift()!;
      slot.worker.ref();
      slot.timer = setTimeout(
        () => this.discard(slot, new Error("Groth16 worker timed out")),
        120_000,
      );
      this.wasm ??= Bun.file(wasmPath).bytes();
      void this.wasm
        .then((wasm) => {
          if (!this.workers.has(slot) || slot.retiring) return;
          slot.worker.postMessage({
            input: slot.job!.input,
            ...(slot.initialized ? {} : { wasm }),
          });
          slot.initialized = true;
        })
        .catch((error) => this.discard(slot, error));
    }
  }
}

export const groth16Pool = new Groth16Pool();
