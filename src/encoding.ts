import type { Certificate, Identified, Statement } from "./types.ts";

/** Canonical JSON uses keys sorted by UTF-8 bytes, no whitespace, and UTF-8 strings.
 * All protocol numeric values are safe nonnegative integers. */
export function canonical(value: unknown): string {
  if (typeof value === "string" && /[\uD800-\uDFFF]/u.test(value))
    throw new Error("invalid Unicode scalar value");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) =>
      Buffer.compare(Buffer.from(a), Buffer.from(b)),
    );
    return `{${keys.map((k) => `${canonical(k)}:${canonical(record[k])}`).join(",")}}`;
  }
  throw new Error("unsupported canonical value");
}
export function sha256(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}
/** Only the canonical encoding round-trips, so this rejects everything else. */
export function decodeBase64(value: unknown): Uint8Array {
  const bytes =
    typeof value === "string" && value.startsWith("base64:")
      ? Buffer.from(value.slice(7), "base64")
      : undefined;
  if (!bytes || encodeBase64(bytes) !== value)
    throw new Error("expected canonical base64: encoding");
  return bytes;
}
export function encodeBase64(value: Uint8Array | string): string {
  return `base64:${Buffer.from(value).toString("base64")}`;
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("expected object");
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    !expected.every((key) => Object.hasOwn(value, key))
  )
    throw new Error("unexpected fields");
}
export function identified(value: unknown): Identified {
  const map = object(value);
  for (const [name, id] of Object.entries(map))
    if (!name || typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id))
      throw new Error("expected Lean names mapped to identities");
  return map as Identified;
}
export function parseStatement(value: unknown): Statement {
  const s = object(value);
  keys(s, ["format", "claims", "axioms"]);
  if (s.format !== "zklean/1")
    throw new Error("unsupported certificate format");
  const statement: Statement = {
    format: s.format,
    claims: identified(s.claims),
    axioms: identified(s.axioms),
  };
  if (!Object.keys(statement.claims).length) throw new Error("no claims");
  // Each name has one meaning: a claim is never also an axiom.
  if (
    Object.keys(statement.claims).some((n) =>
      Object.hasOwn(statement.axioms, n),
    )
  )
    throw new Error("duplicate declaration name");
  return structuredClone(statement);
}
/** The SP1 release whose verifier and guest this profile pins. */
export const SP1_VERSION = "6.10.0";
/** SP1 6's Groth16 encoding: a 4-byte circuit-key selector, the exit code,
 * verifier-key root and proof nonce (32 bytes each), and the 256-byte proof. */
export const PROOF_BYTES = 356;

/** An https URL without credentials, as the URL parser normalizes it. */
export function parseSource(value: unknown): string {
  const url =
    typeof value === "string" && URL.canParse(value) && new URL(value);
  if (!url || url.protocol !== "https:" || url.username || url.password)
    throw new Error("invalid certificate source");
  return url.href;
}
export function parseCertificate(value: unknown): Certificate {
  const { proof, source, ...rest } = object(value);
  if (decodeBase64(proof).length !== PROOF_BYTES)
    throw new Error(`proof must be ${PROOF_BYTES} bytes`);
  // Own the validated data so caller mutation cannot alter an in-flight check.
  return {
    ...parseStatement(rest),
    proof: proof as string,
    source: parseSource(source),
  };
}
export function statement(c: Statement): Statement {
  return {
    format: c.format,
    claims: c.claims,
    axioms: c.axioms,
  };
}
/** The digest the guest commits as its public value. */
export function statementId(c: Statement): string {
  return sha256(`zklean/statement/1\0${canonical(statement(c))}`);
}
export function certificateId(c: Certificate): string {
  return sha256(`zklean/certificate/1\0${canonical(c)}`);
}
