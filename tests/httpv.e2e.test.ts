import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHTTPV, DiscoveryError } from "../src/client.ts";
import { canonical, encodeBase64, readModel, sha256 } from "../src/encoding.ts";
import { MEDIA_TYPE, methodName } from "../src/server.ts";
import { requirements, testAuthority } from "./helpers.ts";
import type { Certificate, Monitor, VerificationResult } from "../src/types.ts";

const authority = testAuthority();
let v1: Certificate, v2: Certificate, v3: Certificate, bridge: Certificate;
let current: Certificate;
let discoveryCount = 0;
const adapter = createHTTPV().serve({
  routes: {
    "POST /transfer": () => {
      discoveryCount++;
      return current;
    },
  },
  fetch: (request) =>
    Response.json({
      method: request.method,
      path: new URL(request.url).pathname,
    }),
});
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, ...adapter });
const url = `http://127.0.0.1:${server.port}/transfer`;
const local = { method: "POST", allowInsecureHttp: true };

beforeAll(async () => {
  v1 = await authority.issue("v1");
  v2 = await authority.issue("v2", [
    "Transfer.transfer_safe",
    "Transfer.authorized_succeeds",
  ]);
  v3 = await authority.issue("v3");
  bridge = await authority.issue(
    "bridge",
    ["Client.requires_auth"],
    ["Transfer.transfer_safe"],
  );
  current = v1;
}, 300_000);
afterAll(() => server.stop(true));

test("live OPTIONS discovery authenticates resource/method and preserves normal requests", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  current = v1;
  const certificate = await httpv.query(url, local);
  expect(certificate).toEqual(v1);
  expect((await httpv.verify(certificate, { allowedAxioms: [] })).status).toBe(
    "verified",
  );
  const response = await fetch(url, {
    method: "OPTIONS",
    headers: { Accept: `${MEDIA_TYPE}; q=1` },
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Accept");
  expect(
    (await fetch(url, { method: "POST" }).then((r) => r.json())).method,
  ).toBe("POST");
  expect(
    (await fetch(url, { method: "OPTIONS" }).then((r) => r.json())).method,
  ).toBe("OPTIONS");
  expect(
    (
      await fetch(url, {
        method: "OPTIONS",
        headers: { Accept: `${MEDIA_TYPE};q=0` },
      }).then((r) => r.json())
    ).method,
  ).toBe("OPTIONS");
  await expect(
    httpv.query(url, { ...local, method: "GET" }),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
  await expect(
    httpv.query(url.replace("transfer", "other"), local),
  ).rejects.toBeInstanceOf(DiscoveryError);
  await expect(httpv.query(url, { method: "POST" })).rejects.toThrow("HTTPS");
  expect(methodName("patch")).toBe("patch");
  expect(methodName("PATCH")).toBe("PATCH");
  expect(methodName("connect")).toBe("connect");
});

test("compatible upgrade adds claims; changed definitions with identical names fail exact policy", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  const required = { format: "httpv/requirements/1" as const, specs: v1.specs };
  for (const certificate of [v1, v2]) {
    current = certificate;
    const remote = await httpv.query(url, local);
    expect(
      (
        await httpv.checkCompatibility({
          certificate: remote,
          requirements: required,
          allowedAxioms: [],
          mode: "exact",
        })
      ).status,
    ).toBe("verified");
  }
  current = v3;
  const remote = await httpv.query(url, local);
  expect((await httpv.verify(remote, { allowedAxioms: [] })).status).toBe(
    "verified",
  );
  expect(
    await httpv.checkCompatibility({
      certificate: remote,
      requirements: required,
      allowedAxioms: [],
      mode: "exact",
    }),
  ).toMatchObject({ status: "incompatible", reason: "requirements-not-met" });
  expect(
    await httpv.checkCompatibility({
      certificate: remote,
      requirements: required,
      allowedAxioms: [],
    }),
  ).toMatchObject({ status: "unknown", reason: "missing-derivation" });
});

test("a separately checked Lean bridge establishes the client requirement", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  const required = await requirements();
  expect(
    await httpv.checkCompatibility({
      certificate: v1,
      requirements: required,
      allowedAxioms: [],
    }),
  ).toMatchObject({ status: "unknown", reason: "missing-derivation" });
  expect(
    await httpv.checkCompatibility({
      certificate: v1,
      requirements: required,
      derivation: bridge,
      allowedAxioms: [],
    }),
  ).toMatchObject({ status: "verified", reason: "derivation" });
  expect(
    await httpv.checkCompatibility({
      certificate: v1,
      requirements: required,
      derivation: bridge,
      allowedAxioms: [],
      mode: "exact",
    }),
  ).toMatchObject({ status: "incompatible", reason: "requirements-not-met" });
  expect(
    await httpv.checkCompatibility({
      certificate: v2,
      requirements: required,
      derivation: bridge,
      allowedAxioms: [],
    }),
  ).toMatchObject({ status: "verified", reason: "derivation" });
  expect(
    await httpv.checkCompatibility({
      certificate: v3,
      requirements: required,
      derivation: bridge,
      allowedAxioms: [],
    }),
  ).toMatchObject({ status: "unknown", reason: "invalid-derivation" });
  expect(
    await httpv.checkCompatibility({
      certificate: v1,
      requirements: required,
      derivation: v1,
      allowedAxioms: [],
    }),
  ).toMatchObject({ status: "unknown", reason: "invalid-derivation" });
});

test("cached verification enforces new axiom policies and detects statement tampering", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  const axioms = ["Trusted.authorization", "Trusted.evidence"];
  const certificate = await authority.issue(
    "axioms",
    ["Transfer.assumed_safe"],
    axioms,
  );
  expect(
    (await httpv.verify(certificate, { allowedAxioms: axioms })).status,
  ).toBe("verified");
  const calls = authority.calls;
  expect(
    (await httpv.verify(certificate, { allowedAxioms: axioms })).status,
  ).toBe("verified");
  expect(authority.calls).toBe(calls);
  expect((await httpv.verify(certificate, { allowedAxioms: [] })).reason).toBe(
    "forbidden-axiom",
  );
  expect(
    (await httpv.verify({ ...certificate, axioms: [] }, { allowedAxioms: [] }))
      .reason,
  ).toBe("invalid-certificate");
  expect(
    (await createHTTPV().verify(certificate, { allowedAxioms: axioms })).reason,
  ).toBe("verifier-unavailable");
  const model = readModel(v1.specs);
  delete model.declarations["Transfer.POST_transfer"];
  const unresolved = {
    ...v1,
    specs: { ...v1.specs, declarations: encodeBase64(canonical(model)) },
  };
  expect((await httpv.verify(unresolved, { allowedAxioms: [] })).reason).toBe(
    "invalid-certificate",
  );
});

test("watch refreshes advertisements, emits transitions, contains callback failures, and stops", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  current = v1;
  const changes: VerificationResult[] = [];
  const errors: unknown[] = [];
  const monitor = httpv.watch({
    url,
    ...local,
    requirements: { format: "httpv/requirements/1", specs: v1.specs },
    mode: "exact",
    interval: 60_000,
    onChange(result) {
      changes.push(result);
      if (changes.length === 1) throw new Error("application callback");
    },
    onError(error) {
      errors.push(error);
    },
  });
  try {
    expect((await monitor.refresh()).status).toBe("verified");
    await monitor.refresh();
    expect(changes).toHaveLength(1);
    current = v2;
    await monitor.refresh();
    current = v3;
    await Promise.all([monitor.refresh(), monitor.refresh()]);
    expect(changes.map((r) => r.status)).toEqual([
      "verified",
      "verified",
      "incompatible",
    ]);
    expect(errors).toHaveLength(1);
    monitor.stop();
    const count = discoveryCount;
    await monitor.refresh();
    expect(discoveryCount).toBe(count);
  } finally {
    monitor.stop();
  }
});

test("a change callback can request and await a follow-up refresh", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  current = v1;
  let changes = 0;
  let monitor!: Monitor;
  monitor = httpv.watch({
    url,
    ...local,
    requirements: { format: "httpv/requirements/1", specs: v1.specs },
    mode: "exact",
    interval: 60_000,
    async onChange() {
      changes++;
      await monitor.refresh();
    },
  });
  try {
    await Promise.race([
      monitor.refresh(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("refresh deadlocked")), 1000),
      ),
    ]);
    expect(changes).toBe(1);
  } finally {
    monitor.stop();
  }
});

test("periodic polling reports an unavailable dependency and honors external cancellation", async () => {
  const controller = new AbortController();
  let monitor: Monitor;
  let calls = 0;
  const statuses: string[] = [];
  const client = createHTTPV({
    backend: authority.backend,
    fetch: async () => {
      calls++;
      return calls === 1
        ? Response.json(
            { certificates: { POST: v1 } },
            { headers: { "content-type": MEDIA_TYPE } },
          )
        : new Response("offline", { status: 503 });
    },
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      monitor.stop();
      reject(new Error("watch did not poll"));
    }, 2000);
    monitor = client.watch({
      url: "https://example.test/transfer",
      method: "POST",
      requirements: { format: "httpv/requirements/1", specs: v1.specs },
      interval: 10,
      signal: controller.signal,
      onChange(result) {
        statuses.push(result.status);
        if (result.status === "unknown") {
          controller.abort();
          clearTimeout(timeout);
          resolve();
        }
      },
    });
  });
  expect(statuses).toEqual(["verified", "unknown"]);
  expect(calls).toBe(2);
});

test("discovery rejects redirects, malformed media, oversized and malformed certificates", async () => {
  const captured: RequestInit[] = [];
  const client = createHTTPV({
    maxResponseBytes: 30,
    fetch: async (_url, init) => {
      captured.push(init!);
      return new Response("x".repeat(31), {
        headers: { "content-type": MEDIA_TYPE },
      });
    },
  });
  await expect(
    client.query("https://example.test/transfer", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "invalid-certificate" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(captured[0]).toMatchObject({
    method: "OPTIONS",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: MEDIA_TYPE, "Cache-Control": "no-cache" },
  });
  const bad = createHTTPV({
    fetch: async () => Response.json({ certificates: { POST: v1 } }),
  });
  await expect(
    bad.query("https://example.test/transfer", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
});

test("caller mutation during verification cannot substitute a different public model", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  const supplied = structuredClone(v3);
  const result = httpv.checkCompatibility({
    certificate: supplied,
    requirements: { format: "httpv/requirements/1", specs: v1.specs },
    allowedAxioms: [],
    mode: "exact",
  });
  supplied.specs = structuredClone(v1.specs);
  expect(await result).toMatchObject({ status: "incompatible" });
});

test("identical proposition syntax cannot hide a redefined operation", async () => {
  const redefined = await authority.issue("changed-definition");
  const originalType = readModel(v1.specs).declarations[
    "Transfer.transfer_safe"
  ]!.thm!.type;
  expect(
    readModel(redefined.specs).declarations["Transfer.transfer_safe"]!.thm!
      .type,
  ).toBe(originalType);
  const httpv = createHTTPV({ backend: authority.backend });
  expect(
    await httpv.checkCompatibility({
      certificate: redefined,
      requirements: { format: "httpv/requirements/1", specs: v1.specs },
      allowedAxioms: [],
      mode: "exact",
    }),
  ).toMatchObject({ status: "incompatible" });
  expect(
    await httpv.checkCompatibility({
      certificate: redefined,
      requirements: await requirements(),
      derivation: bridge,
      allowedAxioms: [],
    }),
  ).toMatchObject({ status: "unknown", reason: "invalid-derivation" });
});

test("file advertisements refresh in place and stale Lean requirement sidecars fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "httpv-e2e-"));
  const path = join(directory, "certificate.json");
  const leanPath = join(directory, "remote.lean");
  const importedPath = join(directory, "Imported.lean");
  await Bun.write(path, JSON.stringify(v1));
  const httpv = createHTTPV({ backend: authority.backend });
  const fileServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...httpv.serve({
      routes: { "POST /transfer": path, "inspect /transfer": path },
      fetch: () => new Response("ordinary"),
    }),
  });
  const target = `http://127.0.0.1:${fileServer.port}/transfer`;
  try {
    expect(await httpv.query(target, local)).toEqual(v1);
    expect(await httpv.query(target, { ...local, method: "inspect" })).toEqual(
      v1,
    );
    await expect(
      httpv.query(target, { ...local, method: "INSPECT" }),
    ).rejects.toMatchObject({ reason: "missing-certificate" });
    await Bun.write(path, JSON.stringify(v3));
    expect(await httpv.query(target, local)).toEqual(v3);
    const source = "import Imported\n-- local requirements snapshot\n";
    const imported = "-- imported requirement definitions\n";
    await Bun.write(leanPath, source);
    await Bun.write(importedPath, imported);
    await Bun.write(
      `${leanPath}.httpv.json`,
      JSON.stringify({
        format: "httpv/requirements/1",
        specs: v1.specs,
        sourceManifest: {
          format: "httpv/source-manifest/1",
          files: {
            "remote.lean": sha256(source),
            "Imported.lean": sha256(imported),
          },
        },
      }),
    );
    expect(
      (
        await httpv.checkCompatibility({
          certificate: v1,
          requirements: leanPath,
          allowedAxioms: [],
        })
      ).status,
    ).toBe("verified");
    await Bun.write(importedPath, `${imported}-- changed\n`);
    expect(
      (
        await httpv.checkCompatibility({
          certificate: v1,
          requirements: leanPath,
          allowedAxioms: [],
        })
      ).reason,
    ).toBe("requirements-unavailable");
  } finally {
    fileServer.stop(true);
    await rm(directory, { recursive: true });
  }
});
