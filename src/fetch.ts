import { runNative } from "./native.ts";
import { standardAxioms } from "./policy.ts";
import type { Certificate } from "./types.ts";

const MAX_EXPORT_BYTES = 1 << 30;

interface Mismatch {
  name: string;
  expected: string;
  actual: string;
}

/** Download a certificate's source export, bounded in size and time. Redirects
 * are refused, so the https rule holds for the address actually fetched.
 * Nothing fetched is executed. */
export async function download(
  url: string,
  timeout = 600_000,
): Promise<string> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
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
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    Buffer.concat(chunks),
  );
}

/** Check a source export with Nanoda and recompute the identities of every
 * claim and every non-standard axiom. Lean's standard axioms are known by
 * identity, and an export of a specification without its proofs omits them. */
export async function matchSource(
  certificate: Certificate,
  exported: string,
  binary: string,
): Promise<Mismatch[]> {
  const expected = {
    ...certificate.claims,
    ...Object.fromEntries(
      Object.entries(certificate.axioms).filter(
        ([name, id]) => standardAxioms[name] !== id,
      ),
    ),
  };
  const actual = (await runNative(binary, "identify", {
    export: exported,
    names: Object.keys(expected),
  })) as Record<string, string>;
  return Object.entries(expected)
    .filter(([name, id]) => actual[name] !== id)
    .map(([name, id]) => ({ name, expected: id, actual: actual[name]! }));
}
