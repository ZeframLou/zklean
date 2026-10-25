import { resolve } from "node:path";
import { beforeAll, expect, test } from "bun:test";
import { statementId } from "../src/encoding.ts";
import { runNative } from "../src/native.ts";
import { binary, buildNative, checked, input } from "./helpers.ts";

beforeAll(buildNative, 300_000);

const hex = /^[0-9a-f]{64}$/;

test("a checked statement is a few hundred bytes of identities, not a model", async () => {
  const value = await checked("v1");
  expect(Object.keys(value.claims)).toEqual(["Inventory.reservation_safe"]);
  expect(Object.keys(value.axioms)).toEqual(["propext"]);
  for (const id of [
    ...Object.values(value.claims),
    ...Object.values(value.axioms),
  ])
    expect(id).toMatch(hex);
  const exported = (await input("v1")).export;
  expect(JSON.stringify(value).length * 500).toBeLessThan(exported.length);
});

test("identities ignore binder names but bind constant names and bodies", async () => {
  const base = await input("identity", ["Demo.identity"]);
  const original = await checked("identity", ["Demo.identity"]);
  // Binder display names are presentation only.
  const renamedBinder = base.export.replace(
    /("forallE":\{"binderInfo":"default","body":\d+,"name":)(\d+)/,
    "$10",
  );
  expect(
    await runNative(binary, "check", { ...base, export: renamedBinder }),
  ).toEqual(original);
  // The claim's own name is part of its identity.
  const renamed = (await runNative(binary, "check", {
    ...base,
    claims: ["Demo.renamed"],
    export: base.export.replace('"str":"identity"', '"str":"renamed"'),
  })) as typeof original;
  expect(renamed.claims["Demo.renamed"]).not.toBe(
    original.claims["Demo.identity"],
  );
});

test("a Prop-valued definition keeps its body in its identity", async () => {
  const request = await input("prop-def", ["Demo.assumed"]);
  const requirements = (export_: string) =>
    runNative(binary, "requirements", {
      ...request,
      export: export_,
    }) as Promise<{
      claims: Record<string, string>;
    }>;
  const before = await requirements(request.export);
  // Same name and type (Prop), different body: Demo.Yes becomes Demo.Yes → Demo.Yes.
  // Kernel node indices are contiguous and precede their uses.
  const changed = request.export
    .replace(
      '{"const":{"name":9,"us":[]},"ie":14}',
      '{"const":{"name":9,"us":[]},"ie":15}',
    )
    .replace('"name":10,"type":14}', '"name":10,"type":15}')
    .replace(
      '{"def":{"all":[9],"hints":{"regular":1},"levelParams":[],"name":9,"safety":"safe","type":0,"value":1}}',
      '{"forallE":{"binderInfo":"default","body":1,"name":7,"type":1},"ie":14}\n{"def":{"all":[9],"hints":{"regular":1},"levelParams":[],"name":9,"safety":"safe","type":0,"value":14}}',
    );
  expect(changed).not.toBe(request.export);
  const after = await requirements(changed);
  expect(after.claims["Demo.assumed"]).not.toBe(before.claims["Demo.assumed"]);
});

test("invalid proofs, missing claims and axiom claims are rejected", async () => {
  const request = await input("identity", ["Demo.identity"]);
  request.export = request.export.replace('"value":6', '"value":0');
  await expect(runNative(binary, "check", request)).rejects.toThrow();
  await expect(
    runNative(binary, "check", {
      ...(await input("v1")),
      claims: ["Missing.claim"],
    }),
  ).rejects.toThrow();
  await expect(
    runNative(binary, "check", await input("axioms", ["Trusted.evidence"])),
  ).rejects.toThrow();
});

test("polymorphic stage guarantees certify multiple claims", async () => {
  const value = await checked("composition", [
    "Pipeline.compose",
    "Pipeline.weaken",
  ]);
  expect(value.axioms).toEqual({});
  expect(Object.keys(value.claims)).toEqual([
    "Pipeline.compose",
    "Pipeline.weaken",
  ]);
  const native = (await runNative(binary, "commitment", value)) as {
    commitment: string;
  };
  expect(native.commitment).toBe(statementId(value));
});

test("reports exactly the used axioms", async () => {
  const claims = ["Inventory.assumed_safe"];
  const value = await checked("axioms", claims);
  expect(Object.keys(value.axioms)).toEqual([
    "Trusted.evidence",
    "Trusted.stock_policy",
  ]);
  const request = await input("axioms", claims);
  request.export +=
    '{"in":6,"str":{"pre":0,"str":"Unused"}}\n{"axiom":{"isUnsafe":false,"levelParams":[],"name":6,"type":0}}\n';
  const extra = (await runNative(binary, "check", request)) as typeof value;
  expect(extra).toEqual(value);
});

test("native and TypeScript use identical authenticated statement bytes", async () => {
  const value = await checked("v1");
  const native = (await runNative(binary, "commitment", value)) as {
    commitment: string;
  };
  expect(statementId(value)).toBe(native.commitment);
  // Pinned cross-language vector also guards accidental encoding changes.
  expect(statementId(value)).toBe(
    "88537ad60a85bd6648c26f0c8f4424936ff3aef3f2508a5ebaae4321174ecd83",
  );
});

test("a mutual block is identified as one unit, and a nested type stands alone", async () => {
  const claims = ["Shapes.even_zero", "Shapes.leaf_eq"];
  const base = await checked("mutual", claims);
  const variant = await checked("mutual-variant", claims);
  const swapped = await checked("mutual-swapped", claims);
  // Renaming a constructor of Odd changes a claim that mentions only Even.
  expect(variant.claims["Shapes.even_zero"]).not.toBe(
    base.claims["Shapes.even_zero"],
  );
  // Block order fixes the recursors' motive order, so it is part of identity.
  expect(swapped.claims["Shapes.even_zero"]).not.toBe(
    base.claims["Shapes.even_zero"],
  );
  // The nested Tree is independent of the mutual block.
  expect(variant.claims["Shapes.leaf_eq"]).toBe(base.claims["Shapes.leaf_eq"]);
  expect(swapped.claims["Shapes.leaf_eq"]).toBe(base.claims["Shapes.leaf_eq"]);
});

test("an export may define the checker's built-in constants only as Lean does", async () => {
  // Its Nat.gcd returns zero, but the checker computes Nat.gcd natively, which
  // would prove False with no axioms.
  await expect(checked("kernel-spoof", ["Attack.claim"])).rejects.toThrow(
    "Nat.gcd differs from Lean's definition",
  );
});

test("a claim stated as an axiom has the proved theorem's identity", async () => {
  const proved = await checked("v1");
  const stated = (await runNative(
    binary,
    "requirements",
    await input("v1-spec"),
  )) as { claims: Record<string, string> };
  expect(stated.claims).toEqual(proved.claims);
});

test("universe parameter names are part of an identity", async () => {
  const claims = ["Pipeline.compose", "Pipeline.weaken"];
  const request = await input("composition", claims);
  const renamed = request.export.replace(
    '{"in":3,"str":{"pre":0,"str":"u"}}',
    '{"in":3,"str":{"pre":0,"str":"u2"}}',
  );
  expect(renamed).not.toBe(request.export);
  const before = await checked("composition", claims);
  const after = (await runNative(binary, "check", {
    ...request,
    export: renamed,
  })) as typeof before;
  expect(after.claims["Pipeline.compose"]).not.toBe(
    before.claims["Pipeline.compose"],
  );
});

test("an ambiguous export with duplicate JSON keys is rejected", async () => {
  const request = await input("identity", ["Demo.identity"]);
  await expect(
    runNative(binary, "check", {
      ...request,
      export: request.export.replace('"body":3', '"body":3,"body":1'),
    }),
  ).rejects.toThrow();
});

test("the pinned constants are exactly those the checker treats by name", async () => {
  const quoted = (text: string) =>
    [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const nanoda = await Bun.file("vendor/nanoda/src/util.rs").text();
  const cached = [...nanoda.matchAll(/self\.find_name\("([^"]+)"\)/g)].map(
    (m) => m[1],
  );
  const lib = await Bun.file("crates/core/src/lib.rs").text();
  const pinned = quoted(
    lib.slice(
      lib.indexOf("pub const KERNEL"),
      lib.indexOf("];", lib.indexOf("pub const KERNEL")),
    ),
  );
  const script = await Bun.file("scripts/pin.ts").text();
  const listed = quoted(
    script.slice(
      script.indexOf("const kernel"),
      script.indexOf("];", script.indexOf("const kernel")),
    ),
  );
  const table = Object.keys(
    await Bun.file("crates/core/src/kernel.json").json(),
  );
  for (const names of [pinned, listed, table])
    expect([...names].sort()).toEqual([...cached].sort());
});

test("inductive metadata in an export is checked, not trusted", async () => {
  const request = await input("prop-def", ["Demo.assumed"]);
  await expect(
    runNative(binary, "requirements", {
      ...request,
      export: request.export.replace('"isRec":false', '"isRec":true'),
    }),
  ).rejects.toThrow();
  // Members of a mutual block must list it in the same order.
  const claims = ["Shapes.even_zero"];
  const mutual = await input("mutual", claims);
  const lines = mutual.export.split("\n").map((line) => {
    if (!line.includes('"inductive"')) return line;
    const row = JSON.parse(line);
    const types = row.inductive.types;
    if (types.length !== 2) return line;
    types[1].all = [...types[1].all].reverse();
    return JSON.stringify(row);
  });
  await expect(
    runNative(binary, "check", { ...mutual, export: lines.join("\n") }),
  ).rejects.toThrow();
});

test("identities do not recurse through long dependency chains", async () => {
  // zklean-native runs with the SP1 guest's 2 MiB stack, so passing here
  // means the guest can prove it too.
  const value = await checked("chain", ["Chain.top"]);
  expect(Object.keys(value.claims)).toEqual(["Chain.top"]);
});
