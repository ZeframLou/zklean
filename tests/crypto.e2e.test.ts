import { beforeAll, expect, test } from "bun:test";
import { resolve, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVerifier, nativeBackend, groth16Backend } from "zklean";
import { sha256, statementCommitment } from "../src/encoding.ts";
import { binary, buildNative, input } from "./helpers.ts";
import { runNative } from "../src/native.ts";
import type { Certificate } from "../src/types.ts";
import { runLake } from "../src/lean.ts";

beforeAll(buildNative, 300_000);

test("embedded verification keeps application timers responsive", async () => {
  const certificate = await Bun.file(
    new URL("./fixtures/identity.certificate.json", import.meta.url),
  ).json();
  expect(
    (await createVerifier().verify(certificate, { allowedAxioms: [] })).status,
  ).toBe("verified");
  let timerFired = false;
  const timer = new Promise<void>((resolve) =>
    setTimeout(() => {
      timerFired = true;
      resolve();
    }, 5),
  );
  expect(
    (await createVerifier().verify(certificate, { allowedAxioms: [] })).status,
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
      createVerifier().verify(certificate, { allowedAxioms: [] }),
    ),
  );
  expect(results.every((result) => result.status === "verified")).toBe(true);
}, 30_000);

test("native and embedded upstream verifiers accept the locally generated Groth16 certificate", async () => {
  const certificate = (await Bun.file(
    resolve(import.meta.dir, "fixtures/identity.certificate.json"),
  ).json()) as Certificate;
  // Migration is incomplete until a real Groth16 fixture is generated.
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
  // A different, independently checked public model is structurally valid and
  // mathematically true, but this proof must not authenticate it.
  const changed = (await runNative(binary, "check", request)) as Certificate;
  const altered = Buffer.from(certificate.proof.slice(7), "base64");
  altered[40] = altered[40]! ^ 1;
  for (const backend of [groth16Backend(), nativeBackend(config)]) {
    const verifier = createVerifier({ backend });
    expect(
      await verifier.verify(certificate, { allowedAxioms: [] }),
    ).toMatchObject({
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
      expect(
        await verifier.verify(invalid, { allowedAxioms: [] }),
      ).toMatchObject({
        status: "unknown",
        reason: "invalid-certificate",
      });
  }
  expect(
    await createVerifier().verify(certificate, { allowedAxioms: [] }),
  ).toMatchObject({
    status: "verified",
    reason: "valid",
  });
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
  expect(
    await createVerifier({ backend: groth16Backend(wrongPin) }).verify(
      certificate,
      { allowedAxioms: [] },
    ),
  ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
  const outOfField = groth16Backend(`0x${"f".repeat(64)}`);
  expect(
    await createVerifier({ backend: outOfField }).verify(certificate, {
      allowedAxioms: [],
    }),
  ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
  expect(
    await createVerifier().verify(certificate, { allowedAxioms: [] }),
  ).toMatchObject({ status: "verified", reason: "valid" });
}, 300_000);

test("authenticated CLI import writes a usable module and rejects tampering without overwriting it", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "zklean-authenticated-import-"),
  );
  const certificate = resolve(
    import.meta.dir,
    "fixtures/identity.certificate.json",
  );
  const profile = resolve(import.meta.dir, "fixtures/identity.verifier.json");
  const output = join(directory, "Remote.lean");
  const invoke = async (command: string, path: string) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "src/cli.ts",
        command,
        "--certificate",
        path,
        "--config",
        profile,
        ...(command === "import" ? ["--out", output] : []),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
  try {
    expect(await invoke("import", certificate)).toMatchObject({ code: 0 });
    const source = await Bun.file(output).text();
    const pins = await Bun.file(`${output}.axioms.json`).text();
    expect(Object.keys(JSON.parse(pins))).toEqual(["Demo.identity"]);
    if (process.env.ZKLEAN_LAKE) {
      await Bun.write(
        join(directory, "lean-toolchain"),
        "leanprover/lean4:v4.36.0-rc1\n",
      );
      await Bun.write(
        join(directory, "lakefile.toml"),
        'name = "AuthenticatedImport"\n',
      );
      await runLake(directory, process.env.ZKLEAN_LAKE, [
        "env",
        "lean",
        "Remote.lean",
      ]);
    }
    const changed = await Bun.file(certificate).json();
    const proof = Buffer.from(changed.proof.slice(7), "base64");
    proof[40] = proof[40]! ^ 1;
    changed.proof = `base64:${proof.toString("base64")}`;
    const invalid = join(directory, "invalid.json");
    await Bun.write(invalid, JSON.stringify(changed));
    expect(await invoke("import", invalid)).toMatchObject({ code: 1 });
    expect(await Bun.file(output).text()).toBe(source);
    expect(await Bun.file(`${output}.axioms.json`).text()).toBe(pins);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
