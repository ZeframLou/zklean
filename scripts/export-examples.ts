/** Regenerate committed Lean export fixtures from the pinned source exporter. */
import { resolve } from "node:path";
import { main } from "../src/cli.ts";
import { inventoryAxioms } from "../examples/inventory.ts";

export const examples = [
  {
    module: "V1",
    file: "v1",
    claims: ["Inventory.reservation_safe"],
    axioms: inventoryAxioms,
  },
  {
    module: "V2",
    file: "v2",
    claims: ["Inventory.reservation_safe", "Inventory.valid_request_succeeds"],
    axioms: inventoryAxioms,
  },
  {
    module: "V3",
    file: "v3",
    claims: ["Inventory.reservation_safe"],
    axioms: [],
  },
  {
    module: "Requirements",
    file: "requirements",
    claims: ["Client.stock_conserved"],
    axioms: [],
  },
  {
    module: "Bridge",
    file: "bridge",
    claims: ["Client.stock_conserved"],
    axioms: ["Inventory.reservation_safe"],
  },
  {
    module: "Axioms",
    file: "axioms",
    claims: ["Inventory.assumed_safe"],
    axioms: ["Trusted.evidence", "Trusted.stock_policy"],
  },
  {
    module: "ChangedDefinition",
    file: "changed-definition",
    claims: ["Inventory.reservation_safe"],
    axioms: [],
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
