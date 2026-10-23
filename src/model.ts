import type { PublicModel } from "./types.ts";

type Category = "name" | "level" | "expr";
const categories: Record<string, Category> = {
  anonymous: "name",
  str: "name",
  num: "name",
  zero: "level",
  succ: "level",
  max: "level",
  imax: "level",
  param: "level",
  bvar: "expr",
  sort: "expr",
  const: "expr",
  app: "expr",
  lam: "expr",
  forallE: "expr",
  letE: "expr",
  proj: "expr",
  natVal: "expr",
  strVal: "expr",
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid kernel object");
  return value as Record<string, unknown>;
}
function variant(value: unknown): [string, unknown] {
  const entries = Object.entries(record(value));
  if (entries.length !== 1) throw new Error("invalid kernel variant");
  return entries[0]!;
}

/** Resolve every typed reference and every constant against the public model.
 * Hashes preserve DAG sharing and make expression equality context-independent.
 * Checking closure here also validates locally supplied requirement models. */
export function validateModel(model: PublicModel): void {
  const active = new Set<string>();
  const seen = new Set<string>();
  const constants = new Set<string>();
  const ref = (value: unknown, category: Category): void => {
    if (typeof value !== "string" || !Object.hasOwn(model.nodes, value))
      throw new Error("unresolved kernel reference");
    const [kind, data] = variant(model.nodes[value]);
    if (categories[kind] !== category || active.has(value))
      throw new Error("invalid kernel reference");
    if (seen.has(value)) return;
    active.add(value);
    visit(kind, data);
    active.delete(value);
    seen.add(value);
  };
  const list = (value: unknown, category: Category): void => {
    if (!Array.isArray(value))
      throw new Error("expected kernel reference array");
    value.forEach((v) => ref(v, category));
  };
  const constant = (hash: unknown): void => {
    ref(hash, "name");
    constants.add(hash as string);
  };
  const visit = (kind: string, value: unknown): void => {
    if (["anonymous", "zero", "bvar", "natVal", "strVal"].includes(kind))
      return;
    if (["sort", "succ", "param"].includes(kind)) {
      ref(value, kind === "param" ? "name" : "level");
      return;
    }
    if (["max", "imax"].includes(kind)) {
      list(value, "level");
      return;
    }
    const d = record(value);
    if (["str", "num"].includes(kind)) {
      ref(d.pre, "name");
      return;
    }
    if (kind === "const") {
      constant(d.name);
      list(d.us, "level");
      return;
    }
    if (kind === "app") {
      ref(d.fn, "expr");
      ref(d.arg, "expr");
      return;
    }
    if (["lam", "forallE", "letE"].includes(kind)) {
      ref(d.name, "name");
      ref(d.type, "expr");
      ref(d.body, "expr");
      if (kind === "letE") ref(d.value, "expr");
      return;
    }
    if (kind === "proj") {
      constant(d.typeName);
      ref(d.struct, "expr");
      return;
    }
    if (kind === "inductive") {
      for (const [key, subkind] of [
        ["types", "ind-val"],
        ["ctors", "ctor-val"],
        ["recs", "rec-val"],
      ]) {
        if (!Array.isArray(d[key!])) throw new Error("invalid inductive group");
        (d[key!] as unknown[]).forEach((v) => visit(subkind!, v));
      }
      return;
    }
    if (
      ![
        "axiom",
        "thm",
        "def",
        "opaque",
        "quot",
        "ind-val",
        "ctor-val",
        "rec-val",
      ].includes(kind)
    )
      throw new Error("unsupported kernel declaration");
    ref(d.name, "name");
    list(d.levelParams, "name");
    ref(d.type, "expr");
    if (kind === "thm" && "value" in d)
      throw new Error("public theorem contains a proof");
    if ("value" in d) ref(d.value, "expr");
    if ("all" in d) list(d.all, "name");
    if (kind === "ind-val") list(d.ctors, "name");
    if (kind === "ctor-val") constant(d.induct);
    if (kind === "rec-val") {
      if (!Array.isArray(d.rules)) throw new Error("invalid recursor rules");
      for (const r of d.rules) {
        const rule = record(r);
        constant(rule.ctor);
        ref(rule.rhs, "expr");
      }
    }
  };
  const declaredNames = new Set<string>();
  for (const entry of Object.values(model.declarations)) {
    const [kind, value] = variant(entry);
    visit(kind, value);
    const d = record(value);
    if (kind === "inductive") {
      for (const key of ["types", "ctors", "recs"]) {
        for (const item of d[key] as unknown[])
          declaredNames.add(record(item).name as string);
      }
    } else declaredNames.add(d.name as string);
  }
  if ([...constants].some((name) => !declaredNames.has(name)))
    throw new Error("unresolved kernel constant");
  if (seen.size !== Object.keys(model.nodes).length)
    throw new Error("unrelated public kernel nodes");
}
