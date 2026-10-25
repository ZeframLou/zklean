import builtins from "./axioms.json";
import type { Certificate, Identified, Reason, Policy } from "./types.ts";

/** Identities of Lean's standard axioms at the pinned toolchain. */
export const standardAxioms: Identified = builtins;

/** Permission binds a name to its identity, never to its spelling alone. */
export function checkAxioms(
  certificate: Pick<Certificate, "axioms">,
  policy: Policy,
): Reason | undefined {
  for (const [name, id] of Object.entries(certificate.axioms)) {
    if (!Object.hasOwn(policy.axioms, name)) return "forbidden-axiom";
    if (policy.axioms[name] !== id) return "axiom-mismatch";
  }
}
