import builtins from "./axioms.json";
import type { Certificate, Identified, Reason, Policy } from "./types.ts";

/** Identities of Lean's standard axioms at the pinned toolchain. */
export const standardAxioms = Object.freeze(builtins) satisfies Identified;

/** The axioms a statement uses that a policy does not permit, by name and
 * identity. Permission binds a name to its identity, never to its spelling. */
export function rejectedAxioms(
  statement: Pick<Certificate, "axioms">,
  policy: Policy,
): [name: string, id: string][] {
  return Object.entries(statement.axioms).filter(
    ([name, id]) =>
      !Object.hasOwn(policy.axioms, name) || policy.axioms[name] !== id,
  );
}

export function checkAxioms(
  statement: Pick<Certificate, "axioms">,
  policy: Policy,
): Exclude<Reason, "valid"> | undefined {
  const rejected = rejectedAxioms(statement, policy);
  if (!rejected.length) return;
  return rejected.some(([name]) => !Object.hasOwn(policy.axioms, name))
    ? "forbidden-axiom"
    : "axiom-mismatch";
}
