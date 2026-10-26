import { parseCertificate } from "./encoding.ts";
import { profile, type Tools } from "./tooling.ts";
import type { Certificate } from "./types.ts";

export interface ProveInput {
  /** NDJSON emitted by the pinned lean4export. */
  export: string;
  claims: string[];
}
/** Process boundary keeps Nanoda's panic-based rejection out of the Bun host.
 * No shell is used. Configuration is supplied by the application, never input. */
export async function runNative(
  binary: string,
  command: string,
  input: unknown,
  timeout = 600_000,
  onProgress?: (text: string) => void,
): Promise<unknown> {
  const child = Bun.spawn([binary, command], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    // A child that already exited is draining its output, not hung.
    if (child.exitCode !== null) return;
    timedOut = true;
    child.kill();
  }, timeout);
  try {
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
    const readStderr = async () => {
      const reader = child.stderr.getReader();
      const decoder = new TextDecoder();
      let tail = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        tail = (tail + text).slice(-4000);
        try {
          onProgress?.(text);
        } catch {
          /* Diagnostics do not interrupt proving. */
        }
      }
      return tail + decoder.decode();
    };
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      readStderr(),
    ]);
    if (timedOut)
      throw new Error(
        `zklean-native ${command} timed out after ${timeout / 1000} s`,
      );
    if (code !== 0)
      throw new Error(
        `zklean-native ${command} failed (${code}): ${stderr.slice(-4000)}`,
      );
    return JSON.parse(stdout);
  } finally {
    clearTimeout(timer);
  }
}
/** A timeout in milliseconds that setTimeout honours exactly. */
export function parseTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 0x7fffffff)
    throw new Error("timeout must be an integer from 1 to 2147483647 ms");
  return timeout;
}
/** Prove a checked statement with the pinned guest. Proving needs the guest
 * ELF named by the profile's digest; verification never does. */
export async function prove(
  input: ProveInput,
  source: string,
  options: { tools: Tools; timeout?: number | undefined },
): Promise<Certificate> {
  const { tools } = options;
  if (!tools.elf) throw new Error("guest ELF not found; set ZKLEAN_GUEST_ELF");
  const { verifierKey, elfSha256 } = await profile(tools);
  const timeout = options.timeout ?? 3_600_000;
  const proved = (await runNative(
    tools.binary,
    "prove",
    { elfPath: tools.elf, elfSha256, verifierKey, input },
    timeout,
    (text) => process.stderr.write(text),
  )) as object;
  return parseCertificate({ ...proved, source });
}
