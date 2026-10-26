import { beforeAll, expect, test } from "bun:test";
import { checkAxioms, createVerifier, standardAxioms } from "../src/index.ts";
import { binary, buildNative, checked, input } from "./helpers.ts";
import { runNative } from "../src/native.ts";

beforeAll(buildNative, 300_000);

test("standard axiom permissions reject a different proposition under the same name", async () => {
  const real = await checked("v1");
  const propext = { propext: standardAxioms.propext! };
  expect(checkAxioms(real, { axioms: propext })).toBeUndefined();
  expect(checkAxioms(real, { axioms: {} })).toBe("forbidden-axiom");
  const spoof = (await runNative(
    binary,
    "check",
    await input("axiom-spoof", ["Spoof.everything"]),
  )) as typeof real;
  expect(checkAxioms(spoof, { axioms: propext })).toBe("axiom-mismatch");
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
  expect(stderr).toMatch(
    /propext [0-9a-f]{64} \(differs from the permitted identity\)/,
  );
});

test("custom axioms are permitted only by their reviewed identities", async () => {
  const statement = await checked("axioms", ["Inventory.assumed_safe"]);
  expect(checkAxioms(statement, { axioms: standardAxioms })).toBe(
    "forbidden-axiom",
  );
  expect(checkAxioms(statement, { axioms: statement.axioms })).toBeUndefined();
  expect(
    checkAxioms(statement, {
      axioms: { ...statement.axioms, "Trusted.evidence": "0".repeat(64) },
    }),
  ).toBe("axiom-mismatch");
});

test("concurrent checks of one certificate share a single backend run", async () => {
  const certificate = {
    ...(await checked("identity", ["Demo.identity"])),
    proof: `base64:${Buffer.alloc(356).toString("base64")}`,
    source: "https://example.com/identity.ndjson",
  };
  let calls = 0;
  const verifier = createVerifier({
    backend: {
      async verify() {
        calls++;
        await Bun.sleep(10);
        return true;
      },
    },
  });
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      verifier.verify(certificate, { axioms: {} }),
    ),
  );
  expect(results.every((result) => result.status === "verified")).toBe(true);
  expect(calls).toBe(1);
  // The result carries exactly what was verified, whatever the caller does
  // to its own object meanwhile.
  const copy = structuredClone(certificate);
  const pending = verifier.verify(copy, { axioms: {} });
  (copy.claims as Record<string, string>)["Demo.identity"] = "f".repeat(64);
  expect(await pending).toMatchObject({
    status: "verified",
    claims: certificate.claims,
    axioms: {},
  });
  expect(await verifier.verify(certificate, { axioms: {} })).not.toHaveProperty(
    "detail",
  );
});

test("a rejected policy names the axioms it does not permit", async () => {
  const statement = await checked("axioms", ["Inventory.assumed_safe"]);
  const result = await createVerifier({
    backend: { verify: async () => true },
  }).verify(
    {
      ...statement,
      proof: `base64:${Buffer.alloc(356).toString("base64")}`,
      source: "https://example.com/axioms.ndjson",
    },
    { axioms: {} },
  );
  expect(result).toMatchObject({
    status: "unknown",
    reason: "forbidden-axiom",
    detail: "not permitted: Trusted.evidence, Trusted.stock_policy",
  });
});
