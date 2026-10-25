import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { loadRequirements } from "../src/requirements.ts";
import { parseCertificate } from "../src/encoding.ts";
import { matchSource } from "../src/fetch.ts";
import { binary, checked, root } from "./helpers.ts";
import { findTools, profile } from "../src/tooling.ts";

const lake = process.env.ZKLEAN_LAKE;

test("tool overrides and verifier profiles fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zklean-tools-"));
  const saved = { ...process.env };
  try {
    const missing = join(directory, "missing");
    for (const variable of [
      "ZKLEAN_NATIVE",
      "ZKLEAN_GUEST_ELF",
      "ZKLEAN_EXPORTER",
      "ZKLEAN_LAKE",
      "ZKLEAN_PROFILE",
    ]) {
      process.env[variable] = missing;
      await expect(findTools()).rejects.toThrow(`${variable} not found`);
      process.env = { ...saved };
    }
    const pinned = await Bun.file(join(root, "src/guest.json")).json();
    const path = join(directory, "profile.json");
    for (const fields of [
      { format: "unknown" },
      { sp1Version: "6.0.0" },
      { timeout: 1 },
      { verifierKey: "0x00" },
    ]) {
      await Bun.write(path, JSON.stringify({ ...pinned, ...fields }));
      await expect(
        profile({ ...(await findTools()), profile: path }),
      ).rejects.toThrow("verifier profile");
    }
  } finally {
    process.env = saved;
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
    { ...snapshot, claims: {} },
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

test("a certificate names one https source", () => {
  expect(parseCertificate(certificate).source).toBe(certificate.source);
  for (const source of [
    undefined,
    "ext::sh -c id",
    "http://example.com/spec.ndjson",
    "file:///etc/passwd",
    { url: certificate.source },
  ])
    expect(() => parseCertificate({ ...certificate, source })).toThrow();
});

test("a source export must reproduce every certified identity", async () => {
  const statement = await checked("identity", ["Demo.identity"]);
  const exported = await Bun.file(
    join(import.meta.dir, "fixtures/identity.ndjson"),
  ).text();
  const sourced = parseCertificate({ ...certificate, ...statement });
  expect(await matchSource(sourced, exported, binary)).toEqual([]);
  const forged = { ...sourced, claims: { "Demo.identity": "d".repeat(64) } };
  expect(
    (await matchSource(forged, exported, binary)).map((m) => m.name),
  ).toEqual(["Demo.identity"]);
});
