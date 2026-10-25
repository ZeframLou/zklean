import { fileURLToPath } from "node:url";
import { runNative } from "./native.ts";
import type { Certificate } from "./types.ts";

export const MAX_EXPORT_BYTES = 1 << 30;

export interface Mismatch {
  name: string;
  expected: string;
  actual: string | undefined;
}

/** Download a certificate's source export. Nothing fetched is executed. */
export async function download(url: string): Promise<string> {
  if (url.startsWith("file:")) return Bun.file(fileURLToPath(url)).text();
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_EXPORT_BYTES) throw new Error(`${url}: too large`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
