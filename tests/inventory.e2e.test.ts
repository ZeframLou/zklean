import { expect, test } from "bun:test";
import { createHTTPV } from "../src/index.ts";
import { inventoryHandler } from "../examples/inventory.ts";
import { inventoryAxioms, testAuthority } from "./helpers.ts";

test("inventory reservations conserve stock across concurrent HTTP requests", async () => {
  const authority = testAuthority();
  const certificate = await authority.issue("v1");
  const httpv = createHTTPV({ backend: authority.backend });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...httpv.serve({
      routes: { "POST /reservations": certificate },
      fetch: inventoryHandler(),
    }),
  });
  const url = `http://127.0.0.1:${server.port}/reservations`;
  const reserve = (quantity: unknown) =>
    fetch(url, {
      method: "POST",
      body: JSON.stringify({ quantity }),
    });
  try {
    const advertised = await httpv.query(url, {
      method: "POST",
      allowInsecureHttp: true,
    });
    expect(
      await httpv.checkCompatibility({
        certificate: advertised,
        requirements: {
          format: "httpv/requirements/1",
          specs: certificate.specs,
        },
        allowedAxioms: inventoryAxioms,
        mode: "exact",
      }),
    ).toMatchObject({ status: "verified" });

    // Invalid requests must not consume any of the initial ten units.
    for (const quantity of [0, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1])
      expect((await reserve(quantity)).status).toBe(400);
    expect((await fetch(url, { method: "POST", body: "{" })).status).toBe(400);

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => reserve(3)),
    );
    const accepted = responses.filter((response) => response.status === 201);
    expect(accepted).toHaveLength(3);
    expect(
      responses.filter((response) => response.status === 409),
    ).toHaveLength(3);
    const receipts = await Promise.all(
      accepted.map((response) => response.json()),
    );
    expect(
      receipts.map((receipt) => receipt.remaining).sort((a, b) => a - b),
    ).toEqual([1, 4, 7]);
    expect(receipts.reduce((sum, receipt) => sum + receipt.reserved, 0)).toBe(
      9,
    );
    expect(await reserve(1).then((response) => response.json())).toEqual({
      reserved: 1,
      remaining: 0,
    });
    expect((await reserve(1)).status).toBe(409);
  } finally {
    server.stop(true);
  }
}, 300_000);
