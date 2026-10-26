import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "bun:test";
import { loadRequirements, satisfies } from "../src/requirements.ts";
import { parseCertificate } from "../src/encoding.ts";
import { download, matchSource } from "../src/fetch.ts";
import { binary, buildNative, checked, root } from "./helpers.ts";
import { findTools, profile } from "../src/tooling.ts";

const lake = process.env.ZKLEAN_LAKE;
beforeAll(buildNative, 300_000);

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
  format: "zklean/1" as const,
  claims: { "Demo.identity": "b".repeat(64) },
  axioms: {},
  proof: `base64:${Buffer.alloc(356).toString("base64")}`,
  source: "https://example.com/spec.ndjson",
};

test("certificates parse strictly", () => {
  expect(parseCertificate(certificate)).toEqual(certificate);
  const proof = Buffer.alloc(356);
  for (const changed of [
    { source: undefined },
    { source: "http://example.com/spec.ndjson" },
    { source: "file:///etc/passwd" },
    { source: "https://user:secret@example.com/spec.ndjson" },
    { source: "ext::sh -c id" },
    { proof: `base64:${proof.subarray(1).toString("base64")}` },
    // Nonzero padding bits decode to the same bytes but are not canonical.
    { proof: `base64:${proof.toString("base64").replace(/A=$/, "B=")}` },
    { claims: { "Demo.identity": "B".repeat(64) } },
    { axioms: { "Demo.identity": "c".repeat(64) } },
    { extra: true },
  ])
    expect(() => parseCertificate({ ...certificate, ...changed })).toThrow();
  // A key containing commas must not pass for several expected keys.
  const { claims, axioms, ...rest } = certificate;
  expect(() =>
    parseCertificate({ ...rest, "axioms,claims": { claims, axioms } }),
  ).toThrow();
});

test("satisfaction is by claim name and identity, never by axiom", () => {
  const requirements = {
    format: "zklean/requirements/1" as const,
    claims: { "Demo.identity": "b".repeat(64) },
  };
  expect(satisfies(certificate, requirements)).toBe(true);
  expect(
    satisfies({ claims: { "Demo.identity": "c".repeat(64) } }, requirements),
  ).toBe(false);
  expect(
    satisfies(
      { ...certificate, claims: {}, axioms: requirements.claims } as never,
      requirements,
    ),
  ).toBe(false);
  // An empty requirement would be satisfied by everything.
  expect(satisfies(certificate, { ...requirements, claims: {} })).toBe(false);
});

const fixture = (name: string) =>
  Bun.file(join(import.meta.dir, `fixtures/${name}.ndjson`)).text();

test("a source must reproduce every claim and non-standard axiom", async () => {
  const shapes = ["Shapes.even_zero", "Shapes.leaf_eq"];
  const mutual = parseCertificate({
    ...certificate,
    ...(await checked("mutual", shapes)),
  });
  expect(await matchSource(mutual, await fixture("mutual"), binary)).toEqual(
    [],
  );
  // A different model under the same names does not match.
  expect(
    (await matchSource(mutual, await fixture("mutual-variant"), binary)).map(
      (m) => m.name,
    ),
  ).toEqual(["Shapes.even_zero"]);
  // A specification that states the claim as an axiom, without the proof or
  // the standard axioms the proof used, matches the proved certificate.
  const v1 = parseCertificate({ ...certificate, ...(await checked("v1")) });
  expect(Object.keys(v1.axioms)).toEqual(["propext"]);
  expect(await matchSource(v1, await fixture("v1-spec"), binary)).toEqual([]);
});

test("source downloads refuse redirects", async () => {
  const target = Bun.serve({ port: 0, fetch: () => new Response("export") });
  const redirect = Bun.serve({
    port: 0,
    fetch: () => Response.redirect(`http://127.0.0.1:${target.port}/`, 302),
  });
  try {
    // Following the redirect would succeed, so a rejection means it was refused.
    expect(await download(`http://127.0.0.1:${target.port}/`)).toBe("export");
    await expect(
      download(`http://127.0.0.1:${redirect.port}/`),
    ).rejects.toThrow();
  } finally {
    target.stop(true);
    redirect.stop(true);
  }
});
