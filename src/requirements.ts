import { identified, keys, object } from "./encoding.ts";
import type { Requirements } from "./types.ts";

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
