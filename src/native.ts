import { parseCertificate, statement } from "./encoding.ts";
import type { Certificate, ProofBackend } from "./types.ts";

export interface ProveInput {
  /** NDJSON emitted by the pinned exporter. Standalone theorem bodies are private. */
  export: string;
  claims: string[];
  /** Non-proof declarations to identify, such as an API operation. */
  definitions?: string[];
  /** Prover-side guard; recipients enforce their own policy by identity. */
  allowedAxioms: string[];
}
export interface NativeOptions {
  binary: string;
  elfPath?: string;
  elfSha256?: string;
  /** Pinned guest-key fingerprint from zklean pin. */
  verifierKey: string;
  timeout?: number;
  /** Optional native proving diagnostics, delivered without changing evidence. */
  onProgress?: (text: string) => void;
}

/** Process boundary keeps Nanoda's panic-based rejection out of the Bun host.
 * No shell is used. Configuration is supplied by the application, never input. */
export async function runNative(
  binary: string,
  command: string,
  input: unknown,
  timeout = 120_000,
  onProgress?: (text: string) => void,
): Promise<unknown> {
  const child = Bun.spawn([binary, command], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), timeout);
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
    if (code !== 0)
      throw new Error(
        `zklean-native ${command} failed (${code}): ${stderr.slice(-4000)}`,
      );
    return JSON.parse(stdout);
  } finally {
    clearTimeout(timer);
  }
}
export function nativeBackend(options: NativeOptions): ProofBackend & {
  prove(input: ProveInput, source: string): Promise<Certificate>;
} {
  if (
    options.timeout !== undefined &&
    (!Number.isSafeInteger(options.timeout) ||
      options.timeout < 1 ||
      options.timeout > 0x7fffffff)
  )
    throw new Error(
      "native timeout must be an integer from 1 to 2147483647 milliseconds",
    );
  if (!/^0x[a-f0-9]{64}$/.test(options.verifierKey))
    throw new Error("pin the SP1 guest verification key");
  if (
    (options.elfPath !== undefined || options.elfSha256 !== undefined) &&
    (!options.elfPath || !/^[a-f0-9]{64}$/.test(options.elfSha256 ?? ""))
  ) {
    throw new Error(
      "pin both the guest ELF path and SHA-256 when providing an ELF",
    );
  }
  const binary = options.binary;
  const timeout = options.timeout;
  const config = {
    elfPath: options.elfPath,
    elfSha256: options.elfSha256,
    verifierKey: options.verifierKey,
  };
  return {
    identity: `sp1:5.2.4:groth16:${options.verifierKey}`,
    async prove(input, source) {
      if (!config.elfPath || !config.elfSha256)
        throw new Error("proving requires a pinned guest ELF");
      const proved = (await runNative(
        binary,
        "prove",
        { ...config, input },
        timeout ?? 3_600_000,
        options.onProgress,
      )) as object;
      return parseCertificate({ ...proved, source });
    },
    async verify(value) {
      const result = await runNative(
        binary,
        "verify",
        {
          ...config,
          certificate: { ...statement(value), proof: value.proof },
        },
        timeout,
      );
      return (
        typeof result === "object" &&
        result !== null &&
        "valid" in result &&
        result.valid === true
      );
    },
  };
}
