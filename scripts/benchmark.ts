/** Compare complete certificates and actual checking work, without cache hits. */
import { findTools, nativeOptions } from "../src/tooling.ts";
import { runNative, nativeBackend } from "../src/native.ts";
import { createVerifier } from "../src/verifier.ts";
import { canonical, decodeBase64, parseCertificate } from "../src/encoding.ts";
import { groth16Backend } from "../src/groth16.ts";
import { readModel } from "../src/encoding.ts";

const samples = 7;
const paths = process.argv.slice(2);
if (paths.length !== 2)
  throw new Error(
    "usage: bun scripts/benchmark.ts IDENTITY_CERT COMPOSITION_CERT",
  );
const tools = await findTools();
const native = nativeBackend(await nativeOptions(tools, false));
async function measure(operation: () => Promise<unknown>) {
  const firstStart = performance.now();
  await operation();
  const firstMs = performance.now() - firstStart;
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await operation();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { firstMs, medianMs: times[Math.floor(samples / 2)], minMs: times[0] };
}
const results = [];
for (let i = 0; i < paths.length; i++) {
  const file = Bun.file(paths[i]!);
  const certificate = parseCertificate(await file.json());
  const exported = await Bun.file(
    `tests/fixtures/${i === 0 ? "identity" : "composition"}.ndjson`,
  ).text();
  const policy = { allowedAxioms: certificate.axioms };
  const model = readModel(certificate.specs);
  const verify = (
    backend: typeof native | ReturnType<typeof groth16Backend>,
  ) => {
    const verifier = createVerifier({ backend, cacheSize: 0 });
    return async () => {
      const result = await verifier.verify(certificate, policy);
      if (result.status !== "verified") throw new Error(JSON.stringify(result));
    };
  };
  results.push({
    example: i === 0 ? "identity" : "composition",
    claims: certificate.specs.claims,
    exportBytes: Buffer.byteLength(exported),
    certificateFileBytes: file.size,
    certificateCanonicalBytes: Buffer.byteLength(canonical(certificate)),
    publicModelBytes: decodeBase64(certificate.specs.declarations).length,
    proofBytes: decodeBase64(certificate.proof).length,
    declarations: Object.keys(model.declarations).length,
    kernelNodes: Object.keys(model.nodes).length,
    directNanoda: await measure(() =>
      runNative(tools.binary, "check", {
        export: exported,
        claims: certificate.specs.claims,
        allowedAxioms: certificate.axioms,
      }),
    ),
    nativeVerification: await measure(verify(native)),
    embeddedVerification: await measure(verify(groth16Backend())),
  });
}
console.log(
  JSON.stringify(
    {
      runtime: Bun.version,
      platform: process.platform,
      architecture: process.arch,
      samples,
      results,
    },
    null,
    2,
  ),
);
