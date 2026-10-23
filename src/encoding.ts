import { validateModel } from "./model.ts";
import type { Certificate, PublicModel, Specs } from "./types.ts";

export const MAX_CERTIFICATE_BYTES = 16 * 1024 * 1024;

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
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).sort().join(",") !== expected.sort().join(","))
    throw new Error("unexpected fields");
}
export function names(value: unknown, nonempty = false): string[] {
  if (
    !Array.isArray(value) ||
    (nonempty && value.length === 0) ||
    value.some((n) => typeof n !== "string" || n.length === 0) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("expected unique names");
  }
  if (
    value.some(
      (v, i) =>
        i > 0 &&
        Buffer.compare(Buffer.from(value[i - 1]!), Buffer.from(v)) >= 0,
    )
  ) {
    throw new Error("names must be sorted by UTF-8 bytes");
  }
  return value as string[];
}
export function parseSpecs(value: unknown): Specs {
  const specs = object(value);
  keys(specs, ["declarations", "claims"]);
  decodeBase64(specs.declarations);
  return {
    declarations: specs.declarations as string,
    claims: names(specs.claims, true),
  };
}
export function parseCertificate(value: unknown): Certificate {
  const c = object(value);
  keys(c, ["format", "specs", "axioms", "proof"]);
  if (c.format !== "zklean/1")
    throw new Error("unsupported certificate format");
  const certificate: Certificate = {
    format: c.format,
    specs: parseSpecs(c.specs),
    axioms: names(c.axioms),
    proof: c.proof as string,
  };
  if (decodeBase64(c.proof).length === 0) throw new Error("empty proof");
  if (Buffer.byteLength(canonical(certificate)) > MAX_CERTIFICATE_BYTES)
    throw new Error("certificate too large");
  readModel(certificate.specs);
  // Own the validated data so caller mutation cannot alter an in-flight check.
  return structuredClone(certificate);
}
export function readModel(specs: Specs): PublicModel {
  const bytes = decodeBase64(specs.declarations);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const model = object(JSON.parse(text));
  keys(model, ["format", "declarations", "nodes"]);
  if (model.format !== "lean4/kernel/2" || canonical(model) !== text)
    throw new Error("noncanonical public model");
  const declarations = object(model.declarations);
  const nodes = object(model.nodes);
  for (const [hash, node] of Object.entries(nodes)) {
    if (!/^[0-9a-f]{64}$/.test(hash) || sha256(canonical(node)) !== hash)
      throw new Error("invalid kernel node identity");
  }
  for (const claim of specs.claims) {
    if (!Object.hasOwn(declarations, claim))
      throw new Error("unresolved claim");
  }
  validateModel(model as unknown as PublicModel);
  return model as unknown as PublicModel;
}
export function statement(c: Certificate): Omit<Certificate, "proof"> {
  return { format: c.format, specs: c.specs, axioms: c.axioms };
}
export function statementCommitment(c: Certificate): string {
  return sha256(`zklean/statement/1\0${canonical(statement(c))}`);
}
export function certificateId(c: Certificate): string {
  return sha256(`zklean/certificate/1\0${canonical(c)}`);
}
export function modelId(specs: Specs): string {
  return sha256(`zklean/model/1\0${canonical(specs)}`);
}

/** Bounded LRU. Only successfully authenticated results enter the cache. */
export class Cache<T> {
  private readonly values = new Map<string, T>();
  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0)
      throw new Error("invalid cache size");
  }
  get(key: string): T | undefined {
    const value = this.values.get(key);
    if (value !== undefined) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value;
  }
  set(key: string, value: T): void {
    if (this.capacity === 0) return;
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > this.capacity)
      this.values.delete(this.values.keys().next().value!);
  }
}
