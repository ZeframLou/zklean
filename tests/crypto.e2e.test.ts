import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  createVerifier,
  groth16Backend,
  standardAxioms,
  type Certificate,
} from "zklean";
import { binary, buildNative, input } from "./helpers.ts";
import { runNative } from "../src/native.ts";

beforeAll(buildNative, 300_000);

const fixture = (): Promise<Certificate> =>
  Bun.file(
    resolve(import.meta.dir, "fixtures/identity.certificate.json"),
  ).json();
const valid = { status: "verified", reason: "valid" };
const invalid = { status: "unknown", reason: "invalid-certificate" };

test("the pinned verifier accepts the real Groth16 certificate and nothing else", async () => {
  const certificate = await fixture();
  expect(
    await createVerifier().verify(certificate, { axioms: {} }),
  ).toMatchObject(valid);
  // A different, independently checked statement is well formed and true,
  // but this proof must not authenticate it.
  const request = await input("identity", ["Demo.renamed"]);
  request.export = request.export.replace(
    '"str":"identity"',
    '"str":"renamed"',
  );
  const renamed = (await runNative(binary, "check", request)) as Certificate;
  const altered = Buffer.from(certificate.proof.slice(7), "base64");
  altered[40] = altered[40]! ^ 1;
  for (const forged of [
    { ...renamed, proof: certificate.proof, source: certificate.source },
    { ...certificate, proof: `base64:${altered.toString("base64")}` },
    {
      ...certificate,
      proof: `base64:${altered.subarray(1).toString("base64")}`,
    },
    { ...certificate, axioms: { propext: standardAxioms.propext! } },
  ])
    expect(
      await createVerifier().verify(forged, { axioms: standardAxioms }),
    ).toMatchObject(invalid);
  const key = (
    await Bun.file(resolve(import.meta.dir, "../src/guest.json")).json()
  ).verifierKey as string;
  for (const wrong of [`${key.slice(0, -2)}00`, `0x${"f".repeat(64)}`])
    expect(
      await createVerifier({ backend: groth16Backend(wrong) }).verify(
        certificate,
        { axioms: {} },
      ),
    ).toMatchObject(invalid);
}, 300_000);

test("verification runs off the event loop and concurrent checks share it", async () => {
  const certificate = await fixture();
  let timerFired = false;
  setTimeout(() => (timerFired = true), 5);
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      createVerifier().verify(certificate, { axioms: {} }),
    ),
  );
  expect(results.every((result) => result.status === "verified")).toBe(true);
  expect(timerFired).toBe(true);
}, 60_000);
