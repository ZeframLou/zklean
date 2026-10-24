import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  createVerifier,
  nativeBackend,
  groth16Backend,
  standardAxioms,
} from "zklean";
import { sha256, statementId } from "../src/encoding.ts";
import { binary, buildNative, input } from "./helpers.ts";
import { runNative } from "../src/native.ts";
import type { Certificate } from "../src/types.ts";

beforeAll(buildNative, 300_000);

test("embedded verification keeps application timers responsive", async () => {
  const certificate = await Bun.file(
    new URL("./fixtures/identity.certificate.json", import.meta.url),
  ).json();
  expect(
    (await createVerifier().verify(certificate, { axioms: {} })).status,
  ).toBe("verified");
  let timerFired = false;
  const timer = new Promise<void>((resolve) =>
    setTimeout(() => {
      timerFired = true;
      resolve();
    }, 5),
  );
  expect(
    (await createVerifier().verify(certificate, { axioms: {} })).status,
  ).toBe("verified");
  expect(timerFired).toBe(true);
  await timer;
});

test("concurrent embedded verifications share one worker", async () => {
  const certificate = await Bun.file(
    new URL("./fixtures/identity.certificate.json", import.meta.url),
  ).json();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      createVerifier().verify(certificate, { axioms: {} }),
    ),
  );
  expect(results.every((result) => result.status === "verified")).toBe(true);
}, 30_000);

test("native and embedded upstream verifiers accept the locally generated Groth16 certificate", async () => {
  const certificate = (await Bun.file(
    resolve(import.meta.dir, "fixtures/identity.certificate.json"),
  ).json()) as Certificate;
  expect(Buffer.from(certificate.proof.slice(7), "base64").length).toBe(260);
  const trusted = (await Bun.file(
    resolve(import.meta.dir, "fixtures/identity.verifier.json"),
  ).json()) as { verifierKey: string };
  const config = {
    binary,
    verifierKey: trusted.verifierKey,
  };
  const verifier = createVerifier({ backend: nativeBackend(config) });
  const request = await input("identity", ["Demo.renamed"]);
  request.export = request.export.replace(
    '"str":"identity"',
    '"str":"renamed"',
  );
  // A different, independently checked statement is well formed and
  // mathematically true, but this proof must not authenticate it.
  const changed = {
    ...((await runNative(binary, "check", request)) as Certificate),
    source: certificate.source,
  };
  const altered = Buffer.from(certificate.proof.slice(7), "base64");
  altered[40] = altered[40]! ^ 1;
  for (const backend of [groth16Backend(), nativeBackend(config)]) {
    const verifier = createVerifier({ backend });
    expect(await verifier.verify(certificate, { axioms: {} })).toMatchObject({
      status: "verified",
      reason: "valid",
    });
    for (const invalid of [
      { ...changed, proof: certificate.proof },
      { ...certificate, proof: `base64:${altered.toString("base64")}` },
      {
        ...certificate,
        proof: `base64:${altered.subarray(1).toString("base64")}`,
      },
    ])
      expect(await verifier.verify(invalid, { axioms: {} })).toMatchObject({
        status: "unknown",
        reason: "invalid-certificate",
      });
  }
  expect(
    await createVerifier().verify(certificate, { axioms: {} }),
  ).toMatchObject({
    status: "verified",
    reason: "valid",
  });
  expect(await verifier.verify(certificate, { axioms: {} })).toMatchObject({
    status: "verified",
    reason: "valid",
  });
  // This fixture exercises a full public-value digest with nonzero high bits.
  const digest = sha256(Buffer.from(statementId(certificate), "hex"));
  expect(parseInt(digest.slice(0, 2), 16) & 0xe0).not.toBe(0);
  expect(await verifier.verify(certificate, { axioms: {} })).toMatchObject({
    status: "verified",
    reason: "valid",
  });
  // The original Lean proof terms and guest ELF are not supplied to verification.
  expect(
    await verifier.verify(
      { ...certificate, axioms: { propext: standardAxioms.propext } },
      { axioms: standardAxioms },
    ),
  ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
  const wrongPin = `${trusted.verifierKey.slice(0, -2)}00`;
  const wrong = createVerifier({
    backend: nativeBackend({ ...config, verifierKey: wrongPin }),
  });
  expect(await wrong.verify(certificate, { axioms: {} })).toMatchObject({
    status: "unknown",
    reason: "invalid-certificate",
  });
  expect(
    await createVerifier({ backend: groth16Backend(wrongPin) }).verify(
      certificate,
      { axioms: {} },
    ),
  ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
  const outOfField = groth16Backend(`0x${"f".repeat(64)}`);
  expect(
    await createVerifier({ backend: outOfField }).verify(certificate, {
      axioms: {},
    }),
  ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
  expect(
    await createVerifier().verify(certificate, { axioms: {} }),
  ).toMatchObject({ status: "verified", reason: "valid" });
}, 300_000);
