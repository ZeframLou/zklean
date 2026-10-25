/** Regenerate committed Lean export fixtures from the pinned source exporter. */
import { resolve } from "node:path";
import { main } from "../src/cli.ts";

export const examples = [
  {
    module: "Composition",
    file: "composition",
    claims: ["Pipeline.compose", "Pipeline.weaken"],
  },
  {
    module: "AxiomSpoof",
    file: "axiom-spoof",
    claims: ["Spoof.everything"],
  },
  {
    module: "V1",
    file: "v1",
    claims: ["Inventory.reservation_safe"],
  },
  {
    module: "Axioms",
    file: "axioms",
    claims: ["Inventory.assumed_safe"],
  },
  {
    module: "Identity",
    file: "identity",
    claims: ["Demo.identity"],
  },
  {
    module: "PropDef",
    file: "prop-def",
    claims: ["Demo.assumed"],
  },
  {
    module: "ProofData",
    file: "proof-data",
    claims: ["Demo.checked_true"],
  },
];
if (import.meta.main) {
  const exporter = process.argv[2];
  if (!exporter)
    throw new Error(
      "usage: bun scripts/export-examples.ts PATH_TO_LEAN4EXPORT",
    );
  for (const example of examples) {
    await main([
      "export",
      "--project",
      resolve("examples/lean"),
      "--module",
      example.module,
      "--exporter",
      resolve(exporter),
      "--claims",
      example.claims.join(","),
      "--out",
      `tests/fixtures/${example.file}.ndjson`,
    ]);
  }
}
