import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createVerifier, nativeBackend, groth16Backend } from "zklean";
import { sha256, statementCommitment } from "../src/encoding.ts";
import { binary, buildNative } from "./helpers.ts";
import type { Certificate } from "../src/types.ts";

beforeAll(buildNative, 300_000);

test("native and embedded upstream verifiers accept the locally generated Groth16 certificate", async () => {
  const certificate = (await Bun.file(
    resolve(import.meta.dir, "fixtures/identity.certificate.json"),
  ).json()) as Certificate;
  // Migration is incomplete until a real Groth16 fixture is generated.
  expect(Buffer.from(certificate.proof.slice(7), "base64").length).toBe(260);
  for (const verifier of [
    createVerifier(),
    createVerifier({ backend: groth16Backend() }),
  ]) {
    expect(
      await verifier.verify(certificate, { allowedAxioms: [] }),
    ).toMatchObject({ status: "verified", reason: "valid" });
  }
  const trusted = (await Bun.file(
    resolve(import.meta.dir, "fixtures/identity.verifier.json"),
  ).json()) as { verifierKey: string };
  const config = {
    binary,
    verifierKey: trusted.verifierKey,
  };
  const verifier = createVerifier({ backend: nativeBackend(config) });
  expect(
    await verifier.verify(certificate, { allowedAxioms: [] }),
  ).toMatchObject({
    status: "verified",
    reason: "valid",
  });
  // This fixture exercises a full public-value digest with nonzero high bits.
  const digest = sha256(Buffer.from(statementCommitment(certificate), "hex"));
  expect(parseInt(digest.slice(0, 2), 16) & 0xe0).not.toBe(0);
  expect(
    await verifier.verify(certificate, { allowedAxioms: [] }),
  ).toMatchObject({
    status: "verified",
    reason: "valid",
  });
  // The original Lean proof terms and guest ELF are not supplied to verification.
  expect(
    await verifier.verify(
      { ...certificate, axioms: ["propext"] },
      { allowedAxioms: ["propext"] },
    ),
  ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
  const wrongPin = `${trusted.verifierKey.slice(0, -2)}00`;
  const wrong = createVerifier({
    backend: nativeBackend({ ...config, verifierKey: wrongPin }),
  });
  expect(await wrong.verify(certificate, { allowedAxioms: [] })).toMatchObject({
    status: "unknown",
    reason: "invalid-certificate",
  });
}, 300_000);
