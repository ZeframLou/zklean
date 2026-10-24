// Compiled WASM and its memory stay off the host thread.
import { parentPort } from "node:worker_threads";
let instance;
parentPort.on("message", async (data) => {
  try {
    instance ??= (await WebAssembly.instantiate(data.wasm)).instance;
    const exports = instance.exports;
    new Uint8Array(exports.memory.buffer, exports.input_buffer(), 324).set(
      data.input,
    );
    let valid;
    try {
      valid = exports.verify() === 1;
    } catch {
      // A trapping proof is invalid. The trap can leave Rust state
      // inconsistent, so the host replaces this worker.
      parentPort.postMessage({ valid: false, reset: true });
      return;
    }
    parentPort.postMessage({ valid });
  } catch (error) {
    parentPort.postMessage({ error: String(error) });
  }
});
