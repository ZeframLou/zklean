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
export function decodeBase64(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    !/^base64:(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("expected canonical base64: encoding");
  }
  const bytes = Buffer.from(value.slice(7), "base64");
  if (encodeBase64(bytes) !== value)
    throw new Error("noncanonical base64 padding bits");
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
  if (Object.keys(value).sort().join(",") !== [...expected].sort().join(","))
    throw new Error("unexpected fields");
}
export function identified(value: unknown): Identified {
  const map = object(value);
  for (const [name, id] of Object.entries(map))
    if (!name || typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id))
      throw new Error("expected Lean names mapped to identities");
  return map as Identified;
}
/** Names are unique across the maps, so each name has one meaning. */
export function distinct(...maps: Identified[]): void {
  const names = maps.flatMap((map) => Object.keys(map));
  if (new Set(names).size !== names.length)
    throw new Error("duplicate declaration name");
}
export function parseStatement(value: unknown): Statement {
  const s = object(value);
  keys(s, ["format", "claims", "definitions", "axioms"]);
  if (s.format !== "zklean/1")
    throw new Error("unsupported certificate format");
  const statement: Statement = {
    format: s.format,
    claims: identified(s.claims),
    definitions: identified(s.definitions),
    axioms: identified(s.axioms),
  };
  if (!Object.keys(statement.claims).length) throw new Error("no claims");
  distinct(statement.claims, statement.definitions, statement.axioms);
  return structuredClone(statement);
}
export function parseCertificate(value: unknown): Certificate {
  const { proof, source, ...rest } = object(value);
  if (decodeBase64(proof).length === 0) throw new Error("empty proof");
  if (typeof source !== "string" || !/^(https|file):\/\/\S+$/.test(source))
    throw new Error("invalid certificate source");
  // Own the validated data so caller mutation cannot alter an in-flight check.
  return { ...parseStatement(rest), proof: proof as string, source };
}
export function statement(c: Statement): Statement {
  return {
    format: c.format,
    claims: c.claims,
    definitions: c.definitions,
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
