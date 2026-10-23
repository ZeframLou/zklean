import { resolve } from "node:path";
import { createHTTPV, nativeBackend, parseCertificate } from "../src/index.ts";
import { findTools, nativeOptions } from "../src/tooling.ts";

const generated = resolve(import.meta.dir, "generated");
const config = await nativeOptions(
  await findTools({ config: `${generated}/verifier.json` }),
  false,
);
const httpv = createHTTPV({ backend: nativeBackend(config) });
const versions = await Promise.all(
  ["v1", "v2", "v3"].map(async (name) =>
    parseCertificate(await Bun.file(`${generated}/${name}.json`).json()),
  ),
);
let version = 0;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  ...httpv.serve({
    routes: { "POST /transfer": () => versions[version]! },
    async fetch(request) {
      if (
        request.method !== "POST" ||
        new URL(request.url).pathname !== "/transfer"
      )
        return new Response("Not found", { status: 404 });
      const body = (await request.json()) as { authorized?: unknown };
      if (typeof body.authorized !== "boolean")
        return new Response("authorized must be boolean", { status: 400 });
      return Response.json({ accepted: version === 2 || body.authorized });
    },
  }),
});
const url = `http://127.0.0.1:${server.port}/transfer`;
const requirements = {
  format: "httpv/requirements/1" as const,
  specs: versions[0]!.specs,
};
try {
  for (version = 0; version < versions.length; version++) {
    const certificate = await httpv.query(url, {
      method: "POST",
      allowInsecureHttp: true,
    });
    const result = await httpv.checkCompatibility({
      certificate,
      requirements,
      mode: "exact",
      allowedAxioms: [],
    });
    console.log(`V${version + 1}: ${result.status} (${result.reason})`);
    // A client-defined failure policy: only send dependent requests after checking.
    if (result.status === "verified") {
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ authorized: false }),
      });
      console.log("Unauthorized request:", await response.json());
    } else console.log("Client policy blocked the request.");
  }
  const bridged = await httpv.checkCompatibility({
    certificate: versions[1],
    requirements: `${generated}/requirements.json`,
    allowedAxioms: [],
    derivation: await Bun.file(`${generated}/bridge.json`).json(),
  });
  console.log(`Independent Lean bridge: ${bridged.status} (${bridged.reason})`);
} finally {
  server.stop(true);
}
