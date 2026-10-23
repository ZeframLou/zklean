import { resolve } from "node:path";
import { createHTTPV } from "../src/index.ts";
import { nativeBackend, parseCertificate } from "../src/zklean.ts";
import { inventoryHandler, inventoryAxioms } from "./inventory.ts";
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
    routes: { "POST /reservations": () => versions[version]! },
    fetch: inventoryHandler(() => version === 2),
  }),
});
const url = `http://127.0.0.1:${server.port}/reservations`;
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
      allowedAxioms: inventoryAxioms,
    });
    console.log(`V${version + 1}: ${result.status} (${result.reason})`);
    // A client-defined failure policy: only send dependent requests after checking.
    if (result.status === "verified") {
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ quantity: 3 }),
      });
      console.log("Reserve 3 units:", await response.json());
    } else console.log("Client policy blocked the request.");
  }
  const bridged = await httpv.checkCompatibility({
    certificate: versions[1],
    requirements: `${generated}/requirements.json`,
    allowedAxioms: inventoryAxioms,
    derivation: await Bun.file(`${generated}/bridge.json`).json(),
  });
  console.log(`Independent Lean bridge: ${bridged.status} (${bridged.reason})`);
} finally {
  server.stop(true);
}
