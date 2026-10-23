import { kernelName, publicContext } from "./context.ts";
import { readModel, certificateId } from "./encoding.ts";
import type { Certificate } from "./types.ts";

/** Reconstruct kernel objects through Lean's public API. No new expression
 * parser or elaborator is involved. Callers must authenticate the certificate. */
export function leanModule(certificate: Certificate, inspect = false): string {
  const model = publicContext(
    readModel(certificate.specs),
    certificate.specs.claims,
  );
  const lines = [
    "import Lean",
    "",
    `-- ZKLean certificate ${certificateId(certificate)}`,
    "-- Certified statements are assumptions here; the bridge must be certified separately.",
    "set_option maxRecDepth 10000",
    "set_option maxHeartbeats 10000000",
    "",
    "-- The pinned exporter erases metadata such as Lean's borrowed annotations.",
    "private partial def zkleanKernelExpr (e : Lean.Expr) : Lean.Expr :=",
    "  e.replace fun | .mdata _ body => some (zkleanKernelExpr body) | _ => none",
    "private def zkleanPublicInfo (info : Lean.ConstantInfo) : Lean.ConstantInfo :=",
    "  let type := zkleanKernelExpr info.type",
    "  match info with",
    "  | .axiomInfo v => .axiomInfo { v with type }",
    "  | .thmInfo v => .axiomInfo { name := v.name, levelParams := v.levelParams, type, isUnsafe := false }",
    "  | .defnInfo v => .defnInfo { v with type, value := zkleanKernelExpr v.value, all := [v.name] }",
    "  | .opaqueInfo v => .opaqueInfo { v with type, value := zkleanKernelExpr v.value, all := [v.name] }",
    "  | .inductInfo v => .inductInfo { v with type, isReflexive := false }",
    "  | .ctorInfo v => .ctorInfo { v with type }",
    "  | .recInfo v => .recInfo { v with type, rules := v.rules.map fun r => { r with rhs := zkleanKernelExpr r.rhs } }",
    "  | .quotInfo v => .quotInfo { v with type }",
    "private def zkleanRequire (expected : Lean.ConstantInfo) : Lean.Elab.TermElabM Unit := do",
    '  let some actual := (← Lean.getEnv).find? expected.name | Lean.throwError "missing imported declaration"',
    "  let actual ← match actual with",
    "    | .defnInfo _ | .opaqueInfo _ => do",
    "      if expected.isAxiom && (← Lean.Meta.isProp actual.type) then",
    "        pure (.axiomInfo { name := actual.name, levelParams := actual.levelParams, type := zkleanKernelExpr actual.type, isUnsafe := actual.isUnsafe })",
    "      else pure (zkleanPublicInfo actual)",
    "    | _ => pure (zkleanPublicInfo actual)",
    "  unless actual == expected do",
    '    Lean.throwError m!"ZKLean import collision: {expected.name}"',
    "",
    "open Lean Elab in",
    "run_elab do",
    ...(inspect ? ["  let originalEnv ← getEnv"] : []),
  ];
  const refs = new Map<string, string>();
  const dependencies = new Map<string, Set<string>>();
  const list = (items: unknown) =>
    `[${(items as string[]).map(ref).join(", ")}]`;
  const ref = (hash: unknown): string => {
    const key = hash as string;
    const cached = refs.get(key);
    if (cached) return cached;
    const [kind, data] = Object.entries(model.nodes[key]!)[0]!;
    const d = data as Record<string, unknown>;
    let type: string;
    let value: string;
    switch (kind) {
      case "anonymous":
        type = "Name";
        value = ".anonymous";
        break;
      case "str":
        type = "Name";
        value = `.str ${ref(d.pre)} ${JSON.stringify(d.str)}`;
        break;
      case "num":
        type = "Name";
        value = `.num ${ref(d.pre)} ${d.i}`;
        break;
      case "zero":
        type = "Level";
        value = ".zero";
        break;
      case "succ":
        type = "Level";
        value = `.succ ${ref(data)}`;
        break;
      case "param":
        type = "Level";
        value = `.param ${ref(data)}`;
        break;
      case "max":
      case "imax": {
        const pair = data as string[];
        type = "Level";
        value = `.${kind} ${ref(pair[0])} ${ref(pair[1])}`;
        break;
      }
      case "bvar":
        type = "Expr";
        value = `.bvar ${data}`;
        break;
      case "sort":
        type = "Expr";
        value = `.sort ${ref(data)}`;
        break;
      case "const":
        type = "Expr";
        value = `.const ${ref(d.name)} ${list(d.us)}`;
        break;
      case "app":
        type = "Expr";
        value = `.app ${ref(d.fn)} ${ref(d.arg)}`;
        break;
      case "lam":
      case "forallE":
        type = "Expr";
        value = `.${kind} ${ref(d.name)} ${ref(d.type)} ${ref(d.body)} .${d.binderInfo}`;
        break;
      case "letE":
        type = "Expr";
        value = `.letE ${ref(d.name)} ${ref(d.type)} ${ref(d.value)} ${ref(d.body)} ${d.nondep}`;
        break;
      case "proj":
        type = "Expr";
        value = `.proj ${ref(d.typeName)} ${d.idx} ${ref(d.struct)}`;
        break;
      case "natVal":
        type = "Expr";
        value = `.lit (.natVal ${data})`;
        break;
      case "strVal":
        type = "Expr";
        value = `.lit (.strVal ${JSON.stringify(data)})`;
        break;
      default:
        throw new Error(`unsupported kernel node: ${kind}`);
    }
    const id = `v${refs.size}`;
    refs.set(key, id);
    lines.push(`  let ${id} : ${type} := ${value}`);
    return id;
  };
  const constants = (
    value: unknown,
    found: Set<string>,
    visited = new Set<string>(),
  ): void => {
    if (typeof value === "string" && Object.hasOwn(model.nodes, value)) {
      if (visited.has(value)) return;
      visited.add(value);
      const node = model.nodes[value]!;
      if (node.const)
        found.add(kernelName(model, (node.const as { name: string }).name));
      if (node.proj)
        found.add(
          kernelName(model, (node.proj as { typeName: string }).typeName),
        );
      if (node.natVal !== undefined) found.add("Nat");
      if (node.strVal !== undefined) found.add("String");
      if (node.strVal !== undefined || node.natVal !== undefined) return;
      if (node.str)
        constants((node.str as { pre: string }).pre, found, visited);
      else constants(node, found, visited);
    } else if (Array.isArray(value))
      value.forEach((v) => constants(v, found, visited));
    else if (value && typeof value === "object")
      Object.values(value).forEach((v) => constants(v, found, visited));
  };
  for (const [name, decl] of Object.entries(model.declarations)) {
    const found = new Set<string>();
    constants(decl, found);
    dependencies.set(name, found);
  }
  const emitted = new Set<string>();
  const active = new Set<string>();
  const header = (d: Record<string, unknown>) =>
    `name := ${ref(d.name)}, levelParams := ${list(d.levelParams)}, type := ${ref(d.type)}`;
  const emit = (name: string): void => {
    if (emitted.has(name)) return;
    const decl = model.declarations[name]!;
    if (decl.inductiveMember) {
      emit(decl.inductiveMember.group as string);
      return;
    }
    if (active.has(name))
      throw new Error(`cyclic declaration dependency: ${name}`);
    active.add(name);
    const group = decl.inductive;
    const members = group
      ? ["types", "ctors", "recs"].flatMap((k) =>
          (group[k] as { name: string }[]).map((d) =>
            kernelName(model, d.name),
          ),
        )
      : [name];
    for (const dep of dependencies.get(name)!)
      if (!members.includes(dep)) emit(dep);
    let code: string;
    if (group) {
      const types = group.types as Record<string, unknown>[];
      const ctors = group.ctors as Record<string, unknown>[];
      code = `.inductDecl ${list(types[0]!.levelParams)} ${types[0]!.numParams} [${types
        .map(
          (t) =>
            `{ name := ${ref(t.name)}, type := ${ref(t.type)}, ctors := [${ctors
              .filter((c) => c.induct === t.name)
              .map((c) => `{ name := ${ref(c.name)}, type := ${ref(c.type)} }`)
              .join(", ")}] }`,
        )
        .join(", ")}] false`;
    } else if (decl.quot) code = ".quotDecl";
    else {
      const [kind, d] = Object.entries(decl)[0]!;
      const h = header(d);
      if (kind === "thm" || kind === "axiom")
        code = `.axiomDecl { ${h}, isUnsafe := false }`;
      else if (kind === "opaque")
        code = `.opaqueDecl { ${h}, value := ${ref(d.value)}, isUnsafe := false }`;
      else {
        const hints =
          typeof d.hints === "string"
            ? `.${d.hints}`
            : `.regular ${(d.hints as { regular: number }).regular}`;
        code = `.defnDecl { ${h}, value := ${ref(d.value)}, hints := ${hints}, safety := .safe }`;
      }
    }
    const primary = group
      ? (group.types as { name: string }[])[0]!.name
      : Object.values(decl)[0]!.name;
    const nameRef = ref(primary);
    lines.push(
      `  unless (← getEnv).contains ${nameRef} do`,
      `    addDecl (${code})`,
    );
    members.forEach((member) => emitted.add(member));
    active.delete(name);
  };
  certificate.specs.claims.forEach(emit);
  // Lean already contains core declarations. Reusing a name is safe only when
  // its complete public kernel content agrees with the authenticated model.
  // Check new declarations too: the kernel may generate recursors and members.
  for (const declaration of Object.values(model.declarations)) {
    if (declaration.inductiveMember) continue;
    const entries: [string, Record<string, unknown>][] = declaration.inductive
      ? ["types", "ctors", "recs"].flatMap((kind) =>
          (declaration.inductive![kind] as Record<string, unknown>[]).map(
            (data) => [kind, data] as [string, Record<string, unknown>],
          ),
        )
      : Object.entries(declaration);
    for (const [kind, data] of entries) {
      const tags: Record<string, string> = {
        thm: "axiomInfo",
        axiom: "axiomInfo",
        def: "defnInfo",
        opaque: "opaqueInfo",
        quot: "quotInfo",
        types: "inductInfo",
        ctors: "ctorInfo",
        recs: "recInfo",
      };
      const fields = Object.entries(data)
        .filter(([key]) => !["name", "levelParams", "type"].includes(key))
        .map(([key, value]) => {
          let expected: string;
          if (["value", "induct"].includes(key)) expected = ref(value);
          else if (["all", "ctors"].includes(key)) expected = list(value);
          else if (key === "rules")
            expected = `[${(value as Record<string, unknown>[])
              .map(
                (rule) =>
                  `{ ctor := ${ref(rule.ctor)}, nfields := ${rule.nfields}, rhs := ${ref(rule.rhs)} }`,
              )
              .join(", ")}]`;
          else if (key === "hints")
            expected =
              typeof value === "string"
                ? `.${value}`
                : `.regular ${(value as { regular: number }).regular}`;
          else if (key === "safety") expected = `.${value}`;
          else expected = String(value);
          return `${key} := ${expected}`;
        });
      if (kind === "thm") fields.push("isUnsafe := false");
      if (kind === "types") fields.push("isReflexive := false");
      if (kind === "quot") {
        const display = kernelName(model, data.name as string);
        const tag: Record<string, string> = {
          Quot: "type",
          "Quot.mk": "ctor",
          "Quot.lift": "lift",
          "Quot.ind": "ind",
        };
        fields.push(`kind := .${tag[display]}`);
      }
      lines.push(
        `  zkleanRequire (.${tags[kind]} { ${header(data)}${fields.length ? `, ${fields.join(", ")}` : ""} })`,
      );
    }
  }
  if (inspect) {
    for (const name of Object.keys(model.declarations).sort()) {
      const decl = model.declarations[name]!;
      if (decl.inductiveMember) continue;
      const entries = decl.inductive
        ? (decl.inductive.types as Record<string, unknown>[])
        : Object.values(decl);
      for (const d of entries) {
        const kind = decl.thm ? "theorem" : Object.keys(decl)[0];
        const display = kernelName(model, d.name as string);
        const pad = certificate.specs.claims.includes(display) ? "  " : "    ";
        if (pad.length === 4)
          lines.push(`  unless originalEnv.contains ${ref(d.name)} do`);
        lines.push(
          `${pad}logInfo m!"{${JSON.stringify(`${kind} ${display} : `)}}{← Meta.ppExpr ${ref(d.type)}}"`,
        );
        if (d.value)
          lines.push(`${pad}logInfo m!"  := {← Meta.ppExpr ${ref(d.value)}}"`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
