import { beforeAll, expect, test } from "bun:test";
import {
  canonical,
  decodeBase64,
  encodeBase64,
  readModel,
  sha256,
  statementCommitment,
} from "../src/encoding.ts";
import {
  contextMatches,
  publicContext,
  requirementsFor,
} from "../src/context.ts";
import { runNative } from "../src/native.ts";
import { binary, buildNative, checked, input } from "./helpers.ts";
import type { Certificate, PublicModel } from "../src/types.ts";
import { createVerifier } from "../src/verifier.ts";

beforeAll(buildNative, 300_000);

test("literal dependencies are required before axiom policy traversal", async () => {
  for (const literal of [{ natVal: "0" }, { strVal: "untrusted" }]) {
    const nodes: PublicModel["nodes"] = Object.create(null);
    const add = (node: Record<string, unknown>) => {
      const hash = sha256(canonical(node));
      nodes[hash] = node;
      return hash;
    };
    const anonymous = add({ anonymous: true });
    const name = add({ str: { pre: anonymous, str: "propext" } });
    const type = add(literal);
    const model = {
      format: "lean4/kernel/2",
      nodes,
      declarations: {
        propext: { axiom: { name, type, levelParams: [], isUnsafe: false } },
      },
    };
    const certificate = {
      format: "zklean/1",
      specs: {
        claims: ["propext"],
        declarations: encodeBase64(canonical(model)),
      },
      axioms: ["propext"],
      proof: "base64:AA==",
    };
    expect(() => readModel(certificate.specs)).toThrow(
      "unresolved literal type",
    );
    expect(
      await createVerifier().verify(certificate, {
        allowedAxioms: ["propext"],
      }),
    ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
  }
});

test("projection preserves Lean names that coincide with JavaScript object properties", async () => {
  const request = await input("identity", ["__proto__"]);
  request.export = request.export.replace(
    '{"in":2,"str":{"pre":1,"str":"identity"}}',
    '{"in":2,"str":{"pre":0,"str":"__proto__"}}',
  );
  const statement = (await runNative(binary, "check", request)) as Certificate;
  const model = readModel(statement.specs);
  const projected = publicContext(model, ["__proto__"]);
  expect(Object.hasOwn(projected.declarations, "__proto__")).toBe(true);
  const snapshot = requirementsFor(statement.specs);
  expect(readModel(snapshot.specs).declarations.__proto__).toEqual(
    model.declarations.__proto__,
  );
  expect(contextMatches(projected, model)).toBe(true);
});

test("independent native exports agree on binder renaming but bind the exact bytes", async () => {
  const original = await checked("identity", ["Demo.identity"]);
  const request = await input("identity", ["Demo.identity"]);
  request.export = request.export
    .replace('"str":"P"', '"str":"α"')
    .replace('"str":"h"', '"str":"𐀀"')
    .replaceAll('"binderInfo":"default"', '"binderInfo":"implicit"');
  const renamed = (await runNative(binary, "check", request)) as Certificate;
  expect(
    contextMatches(readModel(original.specs), readModel(renamed.specs)),
  ).toBe(true);
  expect(original.specs.declarations).not.toBe(renamed.specs.declarations);
  for (const statement of [original, renamed]) {
    const result = (await runNative(binary, "commitment", statement)) as {
      commitment: string;
    };
    expect(result.commitment).toBe(
      statementCommitment({ ...statement, proof: "base64:AA==" }),
    );
  }
});

test("public graph validation rejects missing dependencies, unrelated nodes, and forged inductive aliases", async () => {
  const statement = await checked("v1");
  const original = readModel(statement.specs);
  const check = (mutate: (model: PublicModel) => void) => {
    const model = structuredClone(original);
    mutate(model);
    return () =>
      readModel({
        ...statement.specs,
        declarations: encodeBase64(canonical(model)),
      });
  };
  expect(
    check((m) => {
      delete m.declarations.Nat;
    }),
  ).toThrow();
  expect(
    check((m) => {
      delete m.nodes[Object.keys(m.nodes)[0]!];
    }),
  ).toThrow();
  expect(
    check((m) => {
      const extra = { bvar: 65535 };
      m.nodes[sha256(canonical(extra))] = extra;
    }),
  ).toThrow("unrelated");
  expect(
    check((m) => {
      m.declarations["Option.some"] = { inductiveMember: { group: "Nat" } };
    }),
  ).toThrow("inductive member");
  expect(
    check((m) => {
      delete m.declarations["Option.some"];
    }),
  ).toThrow("missing inductive member");
  // A definition body participates in context matching even if the declaration
  // name and theorem type remain the same.
  const changed = structuredClone(original);
  changed.declarations["Inventory.POST_reservations"]!.def!.value =
    changed.declarations["Inventory.POST_reservations"]!.def!.type;
  expect(contextMatches(changed, original)).toBe(false);
});

test("encoding rejects padding aliases and unpaired surrogates while ordering Unicode by UTF-8", () => {
  expect(decodeBase64("base64:AA==")).toEqual(Buffer.from([0]));
  expect(() => decodeBase64("base64:AB==")).toThrow("padding bits");
  expect(() => decodeBase64("base64:AAB=")).toThrow("padding bits");
  expect(() => canonical("\ud800")).toThrow("Unicode");
  expect(() => canonical({ ["\udfff"]: 0 })).toThrow("Unicode");
  expect(canonical({ "𐀀": 1, "\ue000": 2 })).toBe('{"\ue000":2,"𐀀":1}');
  expect(canonical('quote"\n\u0000/\\α')).toBe('"quote\\\"\\n\\u0000/\\\\α"');
});
