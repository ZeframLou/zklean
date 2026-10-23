import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createVerifier, nativeBackend } from "zklean";
import { sha256, statementCommitment } from "../src/encoding.ts";
import { binary, buildNative } from "./helpers.ts";
import type { Certificate } from "../src/types.ts";

beforeAll(buildNative, 300_000);

test("the unmodified SP1 SDK verifies a locally generated compressed STARK certificate", async () => {
  const certificate = (await Bun.file(
    resolve(import.meta.dir, "fixtures/identity.certificate.json"),
  ).json()) as Certificate;
  const trusted = (await Bun.file(
    resolve(import.meta.dir, "fixtures/identity.verifier.json"),
  ).json()) as { verifierKey: string; verificationKey: string };
  const config = {
    binary,
    verifierKey: trusted.verifierKey,
    verificationKey: trusted.verificationKey,
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
    reason: "verifier-unavailable",
  });
}, 300_000);
