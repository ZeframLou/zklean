import { parseCertificate } from "./encoding.ts";
import type { Certificate, ProofBackend } from "./types.ts";

export interface ProveInput {
  /** NDJSON emitted by the pinned lean4export. Proof terms are excluded from the public model. */
  export: string;
  claims: string[];
  allowedAxioms: string[];
}
export interface NativeOptions {
  binary: string;
  elfPath?: string;
  elfSha256?: string;
  verifierKey: string;
  timeout?: number;
}

/** Process boundary keeps Nanoda's panic-based rejection out of the Bun host.
 * No shell is used. Configuration is supplied by the application, never input. */
export async function runNative(
  binary: string,
  command: string,
  input: unknown,
  timeout = 120_000,
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
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
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
export function nativeBackend(
  options: NativeOptions,
): ProofBackend & { prove(input: ProveInput): Promise<Certificate> } {
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
  const config = {
    elfPath: options.elfPath,
    elfSha256: options.elfSha256,
    verifierKey: options.verifierKey,
  };
  return {
    async prove(input) {
      if (!options.elfPath || !options.elfSha256)
        throw new Error("proving requires a pinned guest ELF");
      return parseCertificate(
        await runNative(
          options.binary,
          "prove",
          { ...config, input },
          options.timeout ?? 3_600_000,
        ),
      );
    },
    async verify(certificate) {
      const result = await runNative(
        options.binary,
        "verify",
        { ...config, certificate },
        options.timeout,
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
