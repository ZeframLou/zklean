/** Regenerate committed Lean export fixtures from the pinned source exporter. */
import { resolve } from "node:path";
import { main } from "../src/cli.ts";

const examples = [
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
];
// The exporter comes from ZKLEAN_EXPORTER or scripts/setup-exporter.sh.
for (const example of examples)
  await main([
    "export",
    "--project",
    resolve("examples/lean"),
    "--module",
    example.module,
    "--claims",
    example.claims.join(","),
    "--out",
    `tests/fixtures/${example.file}.ndjson`,
  ]);
