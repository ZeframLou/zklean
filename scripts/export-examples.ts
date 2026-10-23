/** Regenerate committed Lean export fixtures from the pinned source exporter. */
import { resolve } from "node:path";
import { main } from "../src/cli.ts";
import { inventoryAxioms } from "../examples/inventory.ts";

export const examples = [
  {
    module: "AxiomSpoof",
    file: "axiom-spoof",
    claims: ["Spoof.everything"],
    axioms: ["propext"],
  },
  {
    module: "V1",
    file: "v1",
    claims: ["Inventory.reservation_safe"],
    axioms: inventoryAxioms,
  },
  {
    module: "Axioms",
    file: "axioms",
    claims: ["Inventory.assumed_safe"],
    axioms: ["Trusted.evidence", "Trusted.stock_policy"],
  },
  {
    module: "Identity",
    file: "identity",
    claims: ["Demo.identity"],
    axioms: [],
  },
  {
    module: "ProofData",
    file: "proof-data",
    claims: ["Demo.checked_true"],
    axioms: [],
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
