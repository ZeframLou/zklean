import builtins from "./axioms.json";
import { declarationIdentity } from "./context.ts";
import { readModel } from "./encoding.ts";
import type { Certificate, Reason, VerifyOptions } from "./types.ts";

/** Permission binds a name to its resolved proposition, never to its spelling alone. */
export function checkAxioms(
  certificate: Pick<Certificate, "axioms" | "specs">,
  policy: VerifyOptions,
): Reason | undefined {
  if (
    !Array.isArray(policy.allowedAxioms) ||
    certificate.axioms.some((name) => !policy.allowedAxioms.includes(name))
  )
    return "forbidden-axiom";
  if (!certificate.axioms.length) return;
  const model = readModel(certificate.specs);
  const pins: Readonly<Record<string, string>> = {
    ...builtins,
    ...policy.axiomPins,
  };
  for (const name of certificate.axioms) {
    if (
      !Object.hasOwn(model.declarations, name) ||
      !model.declarations[name]!.axiom
    )
      return "invalid-certificate";
    if (!Object.hasOwn(pins, name)) return "unpinned-axiom";
    if (declarationIdentity(model, name) !== pins[name])
      return "axiom-mismatch";
  }
}
