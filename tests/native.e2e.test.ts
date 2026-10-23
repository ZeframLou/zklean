import { resolve } from "node:path";
import { beforeAll, expect, test } from "bun:test";
import {
  canonical,
  decodeBase64,
  readModel,
  statementCommitment,
} from "../src/encoding.ts";
import { nativeBackend, runNative } from "../src/native.ts";
import { binary, buildNative, checked, input } from "./helpers.ts";

beforeAll(buildNative, 300_000);

test("Nanoda checks a Lean export and produces a canonical proof-free closed model", async () => {
  const value = await checked("v1");
  expect(value.axioms).toEqual(["propext"]);
  const text = Buffer.from(decodeBase64(value.specs.declarations)).toString();
  expect(canonical(JSON.parse(text))).toBe(text);
  const model = readModel(value.specs);
  expect(model.format).toBe("lean4/kernel/2");
  expect(
    model.declarations["Inventory.reservation_safe"]!.thm,
  ).not.toHaveProperty("value");
  expect(model.declarations["Inventory.POST_reservations"]).toBeDefined();
  expect(model.declarations).toHaveProperty("Nat");
  const originalNodes = (await input("v1")).export
    .split("\n")
    .filter((line) => /"i[nel]":/.test(line)).length;
  expect(Object.keys(model.nodes).length).toBeLessThan(originalNodes);
  expect(model.declarations["Option"]!.inductive).toBeDefined();
  expect(model.declarations["Option.some"]).toEqual({
    inductiveMember: { group: "Option" },
  });
  expect(model.declarations["Option.rec"]).toEqual({
    inductiveMember: { group: "Option" },
  });
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
    runNative(
      binary,
      "check",
      await input(
        "axioms",
        ["Trusted.evidence"],
        ["Trusted.evidence", "Trusted.stock_policy"],
      ),
    ),
  ).rejects.toThrow();
});

test("computational definitions retain embedded evidence without standalone theorem bodies", async () => {
  const statement = await checked("proof-data", ["Demo.checked_true"]);
  const model = readModel(statement.specs);
  expect(model.declarations["Demo.checked"]!.def!.value).toBeString();
  expect(model.declarations["Demo.checked_true"]!.thm).not.toHaveProperty(
    "value",
  );
  expect(model.declarations["Demo.CheckedValue"]).toBeDefined();
});

test("reports the exact used axioms, including their public declarations", async () => {
  const claims = ["Inventory.assumed_safe"];
  const allowed = ["Trusted.evidence", "Trusted.stock_policy"];
  await expect(
    runNative(binary, "check", await input("axioms", claims)),
  ).rejects.toThrow();
  const value = await checked("axioms", claims, allowed);
  expect(value.axioms).toEqual(allowed);
  expect(readModel(value.specs).declarations["Trusted.evidence"]).toBeDefined();
  const request = await input("axioms", claims, allowed);
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
  expect(statementCommitment({ ...value, proof: "base64:AA==" })).toBe(
    native.commitment,
  );
  // Pinned cross-language vector also guards accidental encoding changes.
  expect(statementCommitment({ ...value, proof: "base64:AA==" })).toBe(
    "b0c3e5826e5ca0f8f3b51da955b86bb9b1a132c59f569372119e508623366ed5",
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
  };
  expect(await nativeBackend(config).verify(certificate)).toBe(false);
  await expect(
    nativeBackend({ ...config, elfSha256: "0".repeat(64) }).verify(certificate),
  ).rejects.toThrow("digest mismatch");
});
