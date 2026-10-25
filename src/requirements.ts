import { identified, keys, object } from "./encoding.ts";
import type { Certificate, Requirements } from "./types.ts";

/** Load a requirements snapshot from an object or a JSON file. Regenerate the
 * snapshot with `zklean requirements` whenever its Lean sources change. */
export async function loadRequirements(
  input: Requirements | string,
): Promise<Requirements> {
  const r = object(
    typeof input === "string" ? await Bun.file(input).json() : input,
  );
  keys(r, ["format", "claims"]);
  if (r.format !== "zklean/requirements/1")
    throw new Error("invalid requirements format");
  const claims = identified(r.claims);
  // An empty requirement would be satisfied by every certificate.
  if (!Object.keys(claims).length) throw new Error("requirements need claims");
  return structuredClone({ format: r.format, claims });
}

/** Whether a certificate proves every required claim: the same name with the
 * same identity among its claims. An axiom never satisfies a requirement.
 * This does not verify the certificate; verify it first. */
export function satisfies(
  certificate: Pick<Certificate, "claims">,
  requirements: Requirements,
): boolean {
  return Object.entries(requirements.claims).every(
    ([name, id]) =>
      Object.hasOwn(certificate.claims, name) &&
      certificate.claims[name] === id,
  );
}
