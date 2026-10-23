/** Offline generation for the live upgrade example. Each proof runs locally. */
import { nativeBackend, runNative } from "../src/native.ts";
import { examples } from "./export-examples.ts";
import type { NativeOptions } from "../src/native.ts";

const config = (await Bun.file(
  process.argv[2] ?? "examples/generated/verifier.json",
).json()) as NativeOptions;
const backend = nativeBackend(config);
for (const example of examples.filter((e) =>
  ["v1", "v2", "v3", "bridge"].includes(e.file),
)) {
  console.log(`Proving ${example.module} locally…`);
  const certificate = await backend.prove({
    export: await Bun.file(`tests/fixtures/${example.file}.ndjson`).text(),
    claims: example.claims,
    allowedAxioms: example.axioms,
  });
  await Bun.write(
    `examples/generated/${example.file}.json`,
    `${JSON.stringify(certificate, null, 2)}\n`,
  );
}
const requirements = await runNative(config.binary, "requirements", {
  export: await Bun.file("tests/fixtures/requirements.ndjson").text(),
  claims: ["Client.requires_auth"],
  allowedAxioms: [],
});
await Bun.write(
  "examples/generated/requirements.json",
  `${JSON.stringify(requirements, null, 2)}\n`,
);
