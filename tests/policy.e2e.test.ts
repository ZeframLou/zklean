import { beforeAll, expect, test } from "bun:test";
import {
  declarationIdentity,
  readModel,
  checkAxioms,
  createVerifier,
  nativeBackend,
} from "../src/index.ts";
import { binary, buildNative, checked, input } from "./helpers.ts";
import { runNative } from "../src/native.ts";

beforeAll(buildNative, 300_000);

test("standard axiom permissions reject a different proposition under the same name", async () => {
  const real = await checked("v1");
  expect(checkAxioms(real, { allowedAxioms: ["propext"] })).toBeUndefined();
  const spoof = (await runNative(
    binary,
    "check",
    await input("axiom-spoof", ["Spoof.everything"], ["propext"]),
  )) as typeof real;
  expect(checkAxioms(spoof, { allowedAxioms: ["propext"] })).toBe(
    "axiom-mismatch",
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "src/cli.ts",
      "check",
      "--export",
      "tests/fixtures/axiom-spoof.ndjson",
      "--claims",
      "Spoof.everything",
      "--axioms",
      "propext",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stderr = await new Response(child.stderr).text();
  expect(await child.exited).toBe(1);
  expect(stderr).toContain("axiom-mismatch");
});

test("custom axiom permissions require independently reviewed context fingerprints", async () => {
  const names = ["Trusted.evidence", "Trusted.stock_policy"];
  const statement = await checked("axioms", ["Inventory.assumed_safe"], names);
  expect(checkAxioms(statement, { allowedAxioms: names })).toBe(
    "unpinned-axiom",
  );
  const model = readModel(statement.specs);
  const axiomPins = Object.fromEntries(
    names.map((name) => [name, declarationIdentity(model, name)]),
  );
  expect(
    checkAxioms(statement, { allowedAxioms: names, axiomPins }),
  ).toBeUndefined();
  expect(
    checkAxioms(statement, {
      allowedAxioms: names,
      axiomPins: { ...axiomPins, "Trusted.evidence": "0".repeat(64) },
    }),
  ).toBe("axiom-mismatch");
});

test("concurrent consumers share one real cryptographic verification", async () => {
  const certificate = await Bun.file(
    new URL("./fixtures/identity.certificate.json", import.meta.url),
  ).json();
  const profile = await Bun.file(
    new URL("./fixtures/identity.verifier.json", import.meta.url),
  ).json();
  const native = nativeBackend({
    binary,
    verifierKey: profile.verifierKey,
  });
  let calls = 0;
  const verifier = createVerifier({
    backend: {
      identity: native.identity,
      async verify(value) {
        calls++;
        return native.verify(value);
      },
    },
  });
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      verifier.verify(certificate, { allowedAxioms: [] }),
    ),
  );
  expect(results.every((result) => result.status === "verified")).toBe(true);
  expect(calls).toBe(1);
}, 300_000);
