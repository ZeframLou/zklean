import { object, parseSpecs, readModel } from "./encoding.ts";
import type { Requirements } from "./types.ts";

/** Load a requirements snapshot from an object or a JSON file. Regenerate the
 * snapshot with `zklean requirements` whenever its Lean sources change. */
export async function loadRequirements(
  input: Requirements | string,
): Promise<Requirements> {
  const r = object(
    typeof input === "string" ? await Bun.file(input).json() : input,
  );
  if (
    r.format !== "zklean/requirements/1" ||
    Object.keys(r).sort().join(",") !== "format,specs"
  )
    throw new Error("invalid requirements format");
  const specs = parseSpecs(r.specs);
  readModel(specs);
  return structuredClone({ format: r.format, specs });
}
