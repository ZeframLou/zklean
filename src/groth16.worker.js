// One request at a time per worker; compiled WASM and memory stay off the host.
import { parentPort } from "node:worker_threads";
let instance;
parentPort.on("message", async (data) => {
  try {
    instance ??= (await WebAssembly.instantiate(data.wasm)).instance;
    const exports = instance.exports;
    new Uint8Array(exports.memory.buffer, exports.input_buffer(), 324).set(
      data.input,
    );
    let valid = false;
    try {
      valid = exports.verify() === 1;
    } catch {
      // Invalid curve encodings and upstream traps fail closed.
    }
    parentPort.postMessage({ valid });
  } catch (error) {
    parentPort.postMessage({ error: String(error) });
  }
});
