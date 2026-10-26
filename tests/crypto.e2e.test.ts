import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  createVerifier,
  groth16Backend,
  parseCertificate,
  standardAxioms,
  type Certificate,
} from "zklean";
import { matchSource } from "../src/fetch.ts";
import { binary, buildNative, input } from "./helpers.ts";
import { runNative } from "../src/native.ts";

beforeAll(buildNative, 300_000);

// The README's progress-bar certificate, the repository's one real proof.
const fixture = (): Promise<Certificate> =>
  Bun.file(
    resolve(import.meta.dir, "fixtures/percent.certificate.json"),
  ).json();
const propext = { axioms: { propext: standardAxioms.propext } };
const valid = { status: "verified", reason: "valid" };
const invalid = { status: "unknown", reason: "invalid-certificate" };

test("the pinned verifier accepts the real Groth16 certificate and nothing else", async () => {
  const certificate = await fixture();
  expect(await createVerifier().verify(certificate, propext)).toMatchObject(
    valid,
  );
  // A different, independently checked statement is well formed and true,
  // but this proof must not authenticate it.
  const request = await input("identity", ["Demo.renamed"]);
  request.export = request.export.replace(
    '"str":"identity"',
    '"str":"renamed"',
  );
  const renamed = (await runNative(binary, "check", request)) as Certificate;
  const proof = Buffer.from(certificate.proof.slice(7), "base64");
  // Selector, exit code, verifier-key root, nonce and Groth16 proof.
  const altered = [0, 35, 40, 80, 200].map((byte) => {
    const copy = Buffer.from(proof);
    copy[byte] = copy[byte]! ^ 1;
    return { ...certificate, proof: `base64:${copy.toString("base64")}` };
  });
  for (const forged of [
    { ...renamed, proof: certificate.proof, source: certificate.source },
    ...altered,
    {
      ...certificate,
      proof: `base64:${proof.subarray(1).toString("base64")}`,
    },
    { ...certificate, axioms: {} },
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
        propext,
      ),
    ).toMatchObject(invalid);
}, 300_000);

test("verification runs off the event loop and concurrent checks share it", async () => {
  const certificate = await fixture();
  let timerFired = false;
  setTimeout(() => (timerFired = true), 5);
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      createVerifier().verify(certificate, propext),
    ),
  );
  expect(results.every((result) => result.status === "verified")).toBe(true);
  expect(timerFired).toBe(true);
}, 60_000);

test("the certificate's export reproduces every identity it certifies", async () => {
  const certificate = parseCertificate(await fixture());
  const exported = await Bun.file(
    resolve(import.meta.dir, "fixtures/percent.ndjson"),
  ).text();
  expect(await matchSource(certificate, exported, binary)).toEqual([]);
});
