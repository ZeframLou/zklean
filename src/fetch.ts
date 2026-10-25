import { runNative } from "./native.ts";
import type { Certificate } from "./types.ts";

export const MAX_EXPORT_BYTES = 1 << 30;

export interface Mismatch {
  name: string;
  expected: string;
  actual: string | undefined;
}

/** Download a certificate's source export, bounded in size and time.
 * Nothing fetched is executed. */
export async function download(
  url: string,
  timeout = 600_000,
): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok || !response.body)
    throw new Error(`${url}: HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > MAX_EXPORT_BYTES) {
      await reader.cancel();
      throw new Error(`${url}: too large`);
    }
    chunks.push(read.value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
}

/** Check a source export with Nanoda and recompute every certified identity. */
export async function matchSource(
  certificate: Certificate,
  exported: string,
  binary: string,
): Promise<Mismatch[]> {
  const expected = { ...certificate.claims, ...certificate.axioms };
  const actual = (await runNative(binary, "identify", {
    export: exported,
    names: Object.keys(expected),
  })) as Record<string, string>;
  return Object.entries(expected)
    .filter(([name, id]) => actual[name] !== id)
    .map(([name, id]) => ({ name, expected: id, actual: actual[name] }));
}
