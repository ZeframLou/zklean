import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { loadRequirements } from "../src/requirements.ts";
import { parseCertificate } from "../src/encoding.ts";
import { download, matchSource } from "../src/fetch.ts";
import { binary, checked } from "./helpers.ts";
import { pathToFileURL } from "node:url";
import { findTools, nativeOptions } from "../src/tooling.ts";

const lake = process.env.ZKLEAN_LAKE;

test("explicit tool and profile paths fail closed instead of falling back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zklean-missing-tools-"));
  try {
    const missing = join(directory, "missing");
    for (const key of ["binary", "elf", "exporter", "lake", "config"])
      await expect(findTools({ [key]: missing })).rejects.toThrow("not found");
    for (const env of [{}, { ZKLEAN_PROFILE: missing }]) {
      const child = Bun.spawn(
        [
          process.execPath,
          "src/cli.ts",
          "verify",
          "--certificate",
          "tests/fixtures/identity.certificate.json",
          ...(Object.keys(env).length ? [] : ["--config", missing]),
        ],
        { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" },
      );
      expect(await child.exited).toBe(1);
      expect(await new Response(child.stderr).text()).toContain(
        "verifier profile not found",
      );
      expect(await new Response(child.stdout).text()).toBe("");
    }
    const profile = await Bun.file(
      join(import.meta.dir, "fixtures/identity.verifier.json"),
    ).json();
    const config = join(directory, "profile.json");
    for (const fields of [
      { format: "unknown" },
      { sp1Version: "6.0.0" },
      { timeout: "86400000" },
      { timeout: 0 },
      { veriferKey: profile.verifierKey },
    ]) {
      await Bun.write(config, JSON.stringify({ ...profile, ...fields }));
      await expect(
        nativeOptions({ ...(await findTools()), config }, false),
      ).rejects.toThrow("verifier profile");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requirements load only exact JSON snapshots", async () => {
  const snapshot = {
    format: "zklean/requirements/1" as const,
    claims: { "Demo.identity": "a".repeat(64) },
  };
  expect(await loadRequirements(snapshot)).toEqual(snapshot);
  for (const invalid of [
    { ...snapshot, sourceManifest: {} },
    { ...snapshot, claims: { "Demo.identity": "A".repeat(64) } },
  ])
    await expect(loadRequirements(invalid as never)).rejects.toThrow();
});

const certificate = {
  format: "zklean/1",
  claims: { "Demo.identity": "b".repeat(64) },
  axioms: {},
  proof: "base64:AA==",
  source: "https://example.com/spec.ndjson",
};

test("a certificate names one https or file source", () => {
  expect(parseCertificate(certificate).source).toBe(certificate.source);
  for (const source of [
    undefined,
    "ext::sh -c id",
    "http://example.com/spec.ndjson",
    { url: certificate.source },
  ])
    expect(() => parseCertificate({ ...certificate, source })).toThrow();
});

test("a source export must reproduce every certified identity", async () => {
  const statement = await checked("identity", ["Demo.identity"]);
  const exported = await download(
    pathToFileURL(join(import.meta.dir, "fixtures/identity.ndjson")).href,
  );
  const sourced = parseCertificate({ ...certificate, ...statement });
  expect(await matchSource(sourced, exported, binary)).toEqual([]);
  const forged = { ...sourced, claims: { "Demo.identity": "d".repeat(64) } };
  expect(
    (await matchSource(forged, exported, binary)).map((m) => m.name),
  ).toEqual(["Demo.identity"]);
});
