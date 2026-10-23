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
function exact(value: unknown, fields: string[]): Record<string, unknown> {
  const result = record(value);
  if (Object.keys(result).sort().join("\0") !== [...fields].sort().join("\0"))
    throw new Error("unexpected kernel fields");
  return result;
}
function variant(value: unknown): [string, unknown] {
  const entries = Object.entries(record(value));
  if (entries.length !== 1) throw new Error("invalid kernel variant");
  return entries[0]!;
}
function uint(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > max
  )
    throw new Error("invalid kernel integer");
  return value as number;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid kernel string");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("invalid kernel boolean");
  return value;
}

/** Strictly validate the complete v2 public kernel schema and its closure. */
export function validateModel(model: PublicModel): void {
  const active = new Set<string>();
  const seen = new Set<string>();
  const constants = new Set<string>();

  const ref = (value: unknown, category: Category): void => {
    const hash = string(value);
    if (!Object.hasOwn(model.nodes, hash))
      throw new Error("unresolved kernel reference");
    const [kind, data] = variant(model.nodes[hash]);
    if (categories[kind] !== category || active.has(hash))
      throw new Error("invalid kernel reference");
    if (seen.has(hash)) return;
    active.add(hash);
    visitNode(kind, data);
    active.delete(hash);
    seen.add(hash);
  };
  const refs = (value: unknown, category: Category): void => {
    if (!Array.isArray(value))
      throw new Error("expected kernel reference array");
    value.forEach((entry) => ref(entry, category));
  };
  const constant = (value: unknown): void => {
    const hash = string(value);
    ref(hash, "name");
    constants.add(hash);
  };
  const binder = (value: unknown): void => {
    if (
      !["default", "implicit", "strictImplicit", "instImplicit"].includes(
        string(value),
      )
    )
      throw new Error("invalid binder info");
  };

  const visitNode = (kind: string, value: unknown): void => {
    if (kind === "anonymous" || kind === "zero") {
      if (value !== true) throw new Error("invalid kernel base node");
      return;
    }
    if (kind === "bvar") {
      uint(value, 0xffff);
      return;
    }
    if (kind === "natVal") {
      if (!/^[0-9]+$/.test(string(value)))
        throw new Error("invalid natural literal");
      return;
    }
    if (kind === "strVal") {
      string(value);
      return;
    }
    if (kind === "sort" || kind === "succ") {
      ref(value, "level");
      return;
    }
    if (kind === "param") {
      ref(value, "name");
      return;
    }
    if (kind === "max" || kind === "imax") {
      if (!Array.isArray(value) || value.length !== 2)
        throw new Error("invalid level pair");
      refs(value, "level");
      return;
    }
    if (kind === "str") {
      const data = exact(value, ["pre", "str"]);
      ref(data.pre, "name");
      const part = string(data.str);
      if (!part || part.includes(".") || /^[0-9]+$/.test(part))
        throw new Error("ambiguous name component");
      return;
    }
    if (kind === "num") {
      const data = exact(value, ["pre", "i"]);
      ref(data.pre, "name");
      uint(data.i, 0xffffffff);
      return;
    }
    if (kind === "const") {
      const data = exact(value, ["name", "us"]);
      constant(data.name);
      refs(data.us, "level");
      return;
    }
    if (kind === "app") {
      const data = exact(value, ["fn", "arg"]);
      ref(data.fn, "expr");
      ref(data.arg, "expr");
      return;
    }
    if (kind === "lam" || kind === "forallE") {
      const data = exact(value, ["name", "type", "body", "binderInfo"]);
      ref(data.name, "name");
      ref(data.type, "expr");
      ref(data.body, "expr");
      binder(data.binderInfo);
      return;
    }
    if (kind === "letE") {
      const data = exact(value, ["name", "type", "value", "body", "nondep"]);
      ref(data.name, "name");
      ref(data.type, "expr");
      ref(data.value, "expr");
      ref(data.body, "expr");
      boolean(data.nondep);
      return;
    }
    if (kind === "proj") {
      const data = exact(value, ["typeName", "idx", "struct"]);
      constant(data.typeName);
      uint(data.idx);
      ref(data.struct, "expr");
      return;
    }
    throw new Error("unsupported kernel node");
  };

  const header = (
    value: unknown,
    fields: string[],
  ): Record<string, unknown> => {
    const data = exact(value, fields);
    ref(data.name, "name");
    refs(data.levelParams, "name");
    ref(data.type, "expr");
    return data;
  };
  const visitDeclaration = (kind: string, value: unknown): void => {
    if (kind === "thm") {
      header(value, ["name", "levelParams", "type"]);
      return;
    }
    if (kind === "axiom") {
      const data = header(value, ["name", "levelParams", "type", "isUnsafe"]);
      boolean(data.isUnsafe);
      return;
    }
    if (kind === "def") {
      const data = header(value, [
        "name",
        "levelParams",
        "type",
        "value",
        "hints",
        "safety",
      ]);
      ref(data.value, "expr");
      if (!["safe", "unsafe", "partial"].includes(string(data.safety)))
        throw new Error("invalid definition safety");
      if (typeof data.hints === "string") {
        if (!["opaque", "abbrev"].includes(data.hints))
          throw new Error("invalid reducibility hint");
      } else uint(exact(data.hints, ["regular"]).regular);
      return;
    }
    if (kind === "opaque") {
      const data = header(value, [
        "name",
        "levelParams",
        "type",
        "value",
        "isUnsafe",
      ]);
      ref(data.value, "expr");
      boolean(data.isUnsafe);
      return;
    }
    if (kind === "quot") {
      header(value, ["name", "levelParams", "type"]);
      return;
    }
    if (kind === "inductive") {
      visitInductive(value);
      return;
    }
    throw new Error("unsupported kernel declaration");
  };
  const visitInductive = (value: unknown): void => {
    const data = exact(value, ["types", "ctors", "recs"]);
    if (
      !Array.isArray(data.types) ||
      !Array.isArray(data.ctors) ||
      !Array.isArray(data.recs)
    )
      throw new Error("invalid inductive group");
    for (const value of data.types) {
      const item = header(value, [
        "name",
        "levelParams",
        "type",
        "numParams",
        "numIndices",
        "all",
        "ctors",
        "numNested",
        "isRec",
        "isUnsafe",
      ]);
      for (const key of ["numParams", "numIndices", "numNested"])
        uint(item[key], 0xffff);
      refs(item.all, "name");
      refs(item.ctors, "name");
      for (const key of ["isRec", "isUnsafe"]) boolean(item[key]);
    }
    for (const value of data.ctors) {
      const item = header(value, [
        "name",
        "levelParams",
        "type",
        "induct",
        "cidx",
        "numParams",
        "numFields",
        "isUnsafe",
      ]);
      constant(item.induct);
      for (const key of ["cidx", "numParams", "numFields"])
        uint(item[key], 0xffff);
      boolean(item.isUnsafe);
    }
    for (const value of data.recs) {
      const item = header(value, [
        "name",
        "levelParams",
        "type",
        "all",
        "numParams",
        "numIndices",
        "numMotives",
        "numMinors",
        "rules",
        "k",
        "isUnsafe",
      ]);
      refs(item.all, "name");
      for (const key of ["numParams", "numIndices", "numMotives", "numMinors"])
        uint(item[key], 0xffff);
      if (!Array.isArray(item.rules)) throw new Error("invalid recursor rules");
      for (const value of item.rules) {
        const rule = exact(value, ["ctor", "nfields", "rhs"]);
        constant(rule.ctor);
        uint(rule.nfields, 0xffff);
        ref(rule.rhs, "expr");
      }
      boolean(item.k);
      boolean(item.isUnsafe);
    }
  };

  const renderName = (hash: unknown): string => {
    const key = string(hash);
    ref(key, "name");
    const [kind, value] = variant(model.nodes[key]);
    if (kind === "anonymous") return "";
    if (kind === "str") {
      const data = record(value);
      const prefix = renderName(data.pre);
      return prefix ? `${prefix}.${string(data.str)}` : string(data.str);
    }
    if (kind === "num") {
      const data = record(value);
      const prefix = renderName(data.pre);
      return prefix ? `${prefix}.${uint(data.i)}` : `${uint(data.i)}`;
    }
    throw new Error("invalid name node");
  };

  const declaredNameHashes = new Set<string>();
  const groups = new Map<string, Set<string>>();
  const aliases: [string, string][] = [];
  for (const [declaredName, entry] of Object.entries(model.declarations)) {
    const [kind, value] = variant(entry);
    if (kind === "inductiveMember") {
      aliases.push([declaredName, string(exact(value, ["group"]).group)]);
      continue;
    }
    visitDeclaration(kind, value);
    if (kind === "inductive") {
      const data = record(value);
      const members = new Set<string>();
      for (const key of ["types", "ctors", "recs"])
        for (const item of data[key] as unknown[]) {
          const hash = string(record(item).name);
          declaredNameHashes.add(hash);
          members.add(renderName(hash));
        }
      const primary = [...members].sort((a, b) =>
        Buffer.compare(Buffer.from(a), Buffer.from(b)),
      )[0];
      if (!primary || primary !== declaredName)
        throw new Error("invalid inductive group identity");
      groups.set(primary, members);
    } else {
      const hash = string(record(value).name);
      declaredNameHashes.add(hash);
      if (renderName(hash) !== declaredName)
        throw new Error("declaration name mismatch");
    }
  }
  for (const [name, group] of aliases) {
    const members = groups.get(group);
    if (!members?.has(name) || name === group)
      throw new Error("invalid inductive member");
  }
  for (const members of groups.values())
    for (const name of members)
      if (!Object.hasOwn(model.declarations, name))
        throw new Error("missing inductive member");
  if ([...constants].some((name) => !declaredNameHashes.has(name)))
    throw new Error("unresolved kernel constant");
  if (seen.size !== Object.keys(model.nodes).length)
    throw new Error("unrelated public kernel nodes");
}
