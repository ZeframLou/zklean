import { resolve } from "node:path";
import { beforeAll, expect, test } from "bun:test";
import { statementId } from "../src/encoding.ts";
import { nativeBackend, runNative } from "../src/native.ts";
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

test("invalid proof terms, missing claims, and axiom claims are rejected", async () => {
  const request = await input("identity", ["Demo.identity"]);
  request.export = request.export.replace('"value":6', '"value":0');
  await expect(runNative(binary, "check", request)).rejects.toThrow();
  await expect(
    runNative(binary, "check", {
      ...(await input("v1")),
      claims: ["Missing.claim"],
    }),
  ).rejects.toThrow();
  const unknownField = await input("v1");
  unknownField.export = unknownField.export.replace(
    '"binderInfo":"default","body":',
    '"binderInfo":"default","junk":true,"body":',
  );
  await expect(runNative(binary, "check", unknownField)).rejects.toThrow(
    "unexpected fields",
  );
  const multipleVariants = await input("v1");
  multipleVariants.export = multipleVariants.export.replace(
    '{"ie":0,"sort":1}',
    '{"ie":0,"sort":1,"bvar":0}',
  );
  await expect(runNative(binary, "check", multipleVariants)).rejects.toThrow(
    "one variant",
  );
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

test("duplicate JSON keys cannot substitute an unchecked proposition", async () => {
  const request = await input("identity", ["Demo.identity"]);
  // Nanoda used to select the first forallE (P → P), while Value selected
  // the second (P). That certified ∀ P, P using a proof of ∀ P, P → P.
  const original =
    '"forallE":{"binderInfo":"default","body":3,"name":3,"type":0}';
  const falseType =
    '"forallE":{"binderInfo":"default","body":1,"name":3,"type":0}';
  const exports = [
    request.export.replace(original, `${original},${falseType}`),
    request.export.replace('"body":3', '"body":3,"body":1'),
    request.export.replace('"body":3', '"body":3,"bo\\u0064y":1'),
  ];
  for (const value of exports)
    await expect(
      runNative(binary, "check", { ...request, export: value }),
    ).rejects.toThrow("duplicate JSON key");
});

test("native and TypeScript use identical authenticated statement bytes", async () => {
  const value = await checked("v1");
  const native = (await runNative(binary, "commitment", value)) as {
    commitment: string;
  };
  expect(statementId(value)).toBe(native.commitment);
  // Pinned cross-language vector also guards accidental encoding changes.
  expect(statementId(value)).toBe(
    "fd547f58206d0485b678ea1918944fde34f2f7a3b7ce2f0b94a2b003b77e9a21",
  );
});

test("offline Groth16 verifier rejects non-SP1 proofs and a changed guest pin", async () => {
  const value = await checked("v1");
  const { sha256 } = await import("../src/encoding.ts");
  const elfPath = resolve(import.meta.dir, "fixtures/identity.ndjson");
  const config = {
    binary,
    elfPath,
    elfSha256: sha256(new Uint8Array(await Bun.file(elfPath).arrayBuffer())),
    verifierKey: `0x${"1".repeat(64)}`,
  };
  const certificate = {
    ...value,
    proof: `base64:${Buffer.alloc(260).toString("base64")}`,
    source: "https://example.com/v1.ndjson",
  };
  expect(await nativeBackend(config).verify(certificate)).toBe(false);
  await expect(
    nativeBackend({ ...config, elfSha256: "0".repeat(64) }).verify(certificate),
  ).rejects.toThrow("digest mismatch");
});
