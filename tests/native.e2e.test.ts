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

beforeAll(buildNative, 120_000);

test("Nanoda checks a Lean export and produces a canonical proof-free closed model", async () => {
  const value = await checked("v1");
  expect(value.axioms).toEqual([]);
  const text = Buffer.from(decodeBase64(value.specs.declarations)).toString();
  expect(canonical(JSON.parse(text))).toBe(text);
  const model = readModel(value.specs);
  expect(model.declarations["Transfer.transfer_safe"]!.thm).not.toHaveProperty(
    "value",
  );
  expect(model.declarations["Transfer.POST_transfer"]).toBeDefined();
  expect(model.declarations).toHaveProperty("Bool");
  const originalNodes = (await input("v1")).export
    .split("\n")
    .filter((line) => /"i[nel]":/.test(line)).length;
  expect(Object.keys(model.nodes).length).toBeLessThan(originalNodes);
});

test("invalid proof terms, missing claims, and axiom claims are rejected", async () => {
  const request = await input("v1");
  request.export = request.export.replace('"value":73', '"value":0');
  await expect(runNative(binary, "check", request)).rejects.toThrow();
  await expect(
    runNative(binary, "check", {
      ...(await input("v1")),
      claims: ["Missing.claim"],
    }),
  ).rejects.toThrow();
  await expect(
    runNative(
      binary,
      "check",
      await input(
        "axioms",
        ["Trusted.evidence"],
        ["Trusted.authorization", "Trusted.evidence"],
      ),
    ),
  ).rejects.toThrow();
});

test("reports the exact used axioms, including their public declarations", async () => {
  const claims = ["Transfer.assumed_safe"];
  const allowed = ["Trusted.authorization", "Trusted.evidence"];
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
    "21f1fe0468c4347c288b8c9339896a015f463b99bc6d987cb3fa953f5608fa1d",
  );
});

test("offline compressed STARK verifier rejects non-SP1 proofs and a changed guest pin", async () => {
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
