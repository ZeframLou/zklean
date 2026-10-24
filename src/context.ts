import { canonical, encodeBase64, readModel, sha256 } from "./encoding.ts";
import type { PublicModel, Requirements, Specs } from "./types.ts";

/** Names are interpreted only after readModel has checked the complete graph. */
export function kernelName(model: PublicModel, hash: string): string {
  const node = model.nodes[hash]!;
  if (node.anonymous) return "";
  const data = (node.str ?? node.num) as {
    pre: string;
    str?: string;
    i?: number;
  };
  const prefix = kernelName(model, data.pre);
  const part = data.str ?? String(data.i);
  return prefix ? `${prefix}.${part}` : part;
}

/** Extract resolved declarations and nodes, without proof-only axiom roots. */
export function publicContext(
  model: PublicModel,
  roots: readonly string[],
): PublicModel {
  const declarations: PublicModel["declarations"] = Object.create(null);
  const nodes: PublicModel["nodes"] = Object.create(null);
  const pending = [...roots];
  const reference = (value: unknown): void => {
    if (typeof value === "string" && Object.hasOwn(model.nodes, value)) {
      if (Object.hasOwn(nodes, value)) return;
      const node = model.nodes[value]!;
      nodes[value] = node;
      const data = (node.const ?? node.proj) as
        | { name?: string; typeName?: string }
        | undefined;
      if (data) pending.push(kernelName(model, (data.name ?? data.typeName)!));
      if (Object.hasOwn(node, "natVal")) pending.push("Nat");
      if (Object.hasOwn(node, "strVal")) pending.push("String");
      // Literal text is data, even when it happens to look like a node hash.
      if (Object.hasOwn(node, "natVal") || Object.hasOwn(node, "strVal"))
        return;
      if (node.str) reference((node.str as { pre: string }).pre);
      else reference(node);
    } else if (Array.isArray(value)) value.forEach(reference);
    else if (value && typeof value === "object")
      Object.values(value).forEach(reference);
  };
  while (pending.length) {
    const name = pending.pop()!;
    if (Object.hasOwn(declarations, name)) continue;
    const declaration = model.declarations[name];
    if (!declaration) throw new Error(`unresolved declaration: ${name}`);
    declarations[name] = declaration;
    if (declaration.inductiveMember) {
      pending.push(declaration.inductiveMember.group as string);
      continue;
    }
    if (declaration.inductive) {
      const group = declaration.inductive;
      for (const key of ["types", "ctors", "recs"])
        for (const member of group[key] as { name: string }[])
          pending.push(kernelName(model, member.name));
    }
    reference(declaration);
  }
  return { format: "lean4/kernel/2", declarations, nodes };
}

/** Compare kernel structure while ignoring bound-variable display annotations.
 * This is conservative structural equality, not a general equivalence checker. */
function normalizeDeclarations(context: PublicModel): Record<string, unknown> {
  const memo = new Map<string, string>();
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string" && Object.hasOwn(context.nodes, value)) {
      const cached = memo.get(value);
      if (cached) return cached;
      const [kind, original] = Object.entries(context.nodes[value]!)[0]!;
      let data: unknown = original;
      if (["lam", "forallE", "letE"].includes(kind)) {
        const {
          name: _name,
          binderInfo: _binder,
          ...body
        } = original as Record<string, unknown>;
        data = body;
      }
      const normalized =
        kind === "str"
          ? { ...(data as object), pre: rewrite((data as { pre: string }).pre) }
          : ["strVal", "natVal"].includes(kind)
            ? data
            : rewrite(data);
      const identity = sha256(canonical({ [kind]: normalized }));
      memo.set(value, identity);
      return identity;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, rewrite(item)]),
      );
    return value;
  };
  const resolved = Object.fromEntries(
    Object.entries(context.declarations).map(([key, entry]) => {
      const data = entry.thm ?? entry.axiom;
      // A certified theorem may be admitted as the same proposition in a bridge.
      if (entry.inductiveMember) return [key, entry];
      const declaration = data
        ? {
            proposition: {
              name: data.name,
              levelParams: data.levelParams,
              type: data.type,
            },
          }
        : entry;
      return [key, rewrite(declaration)];
    }),
  );
  return resolved;
}

export function declarationIdentity(model: PublicModel, name: string): string {
  return sha256(
    `zklean/declaration/1\0${canonical(normalizeDeclarations(publicContext(model, [name])))}`,
  );
}

/** Match every required declaration in one shared, alpha-normalized context. */
export function contextMatches(
  actual: PublicModel,
  required: PublicModel,
): boolean {
  const left = normalizeDeclarations(actual);
  const right = normalizeDeclarations(required);
  return Object.keys(right).every(
    (name) =>
      Object.hasOwn(left, name) &&
      canonical(left[name]) === canonical(right[name]),
  );
}

export function requirementsFor(specs: Specs): Requirements {
  const model = publicContext(readModel(specs), specs.claims);
  return {
    format: "zklean/requirements/1",
    specs: {
      claims: [...specs.claims],
      declarations: encodeBase64(canonical(model)),
    },
  };
}
