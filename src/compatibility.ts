import {
  canonical,
  object,
  parseSpecs,
  readModel,
  sha256,
} from "./encoding.ts";
import type { Certificate, PublicModel, Requirements, Specs } from "./types.ts";

export async function loadRequirements(
  input: Requirements | string,
): Promise<Requirements> {
  let value: unknown = input;
  if (typeof input === "string") {
    const isLean = input.endsWith(".lean");
    value = await Bun.file(isLean ? `${input}.httpv.json` : input).json();
    if (isLean) {
      const expected = object(value).sourceSha256;
      if (
        expected !== sha256(new Uint8Array(await Bun.file(input).arrayBuffer()))
      ) {
        throw new Error("Lean requirements sidecar is stale; regenerate it");
      }
    }
  }
  const r = object(value);
  if (
    r.format !== "httpv/requirements/1" ||
    Object.keys(r).some((k) => !["format", "specs", "sourceSha256"].includes(k))
  ) {
    throw new Error("invalid requirements format");
  }
  const specs = parseSpecs(r.specs);
  readModel(specs);
  return structuredClone({ format: r.format, specs });
}

/** Compare both the types and every resolved definition in their public closure.
 * Declaration names alone never establish compatibility. Proof bodies have
 * already been removed by the guest, so theorem/axiom roles can be compared. */
function declaration(model: PublicModel, name: string): string | undefined {
  const entry = model.declarations[name];
  if (!entry) return undefined;
  const kind = Object.keys(entry)[0];
  if (!kind) return undefined;
  const data = entry[kind]!;
  if (kind === "thm" || kind === "axiom") {
    return canonical({
      proposition: {
        name: data.name,
        levelParams: data.levelParams,
        type: data.type,
      },
    });
  }
  return canonical(entry);
}
function includesContext(actual: PublicModel, required: PublicModel): boolean {
  return Object.keys(required.declarations).every(
    (name) => declaration(actual, name) === declaration(required, name),
  );
}
export function exactMatch(remote: Certificate, requirements: Specs): boolean {
  return (
    requirements.claims.every((name) => remote.specs.claims.includes(name)) &&
    includesContext(readModel(remote.specs), readModel(requirements))
  );
}

/** A bridge is an independently checked Lean proof of the required propositions
 * in an environment where the remote certified propositions may be axioms.
 * Checking every shared definition prevents reinterpreting a named guarantee. */
export function validBridge(
  remote: Certificate,
  requirements: Specs,
  bridge: Certificate,
): boolean {
  const model = readModel(bridge.specs);
  const advertised = readModel(remote.specs);
  const assumed = bridge.axioms.filter((name) =>
    remote.specs.claims.includes(name),
  );
  return (
    requirements.claims.every((name) => bridge.specs.claims.includes(name)) &&
    includesContext(model, readModel(requirements)) &&
    assumed.every(
      (name) => declaration(model, name) === declaration(advertised, name),
    ) &&
    Object.keys(model.declarations)
      .filter((name) => Object.hasOwn(advertised.declarations, name))
      .every(
        (name) => declaration(model, name) === declaration(advertised, name),
      )
  );
}
