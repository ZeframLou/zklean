/** Regenerate committed Lean export fixtures from the pinned source exporter. */
import { resolve } from "node:path";
import { main } from "../src/cli.ts";

export const examples = [
  { module: "V1", file: "v1", claims: ["Transfer.transfer_safe"], axioms: [] },
  {
    module: "V2",
    file: "v2",
    claims: ["Transfer.transfer_safe", "Transfer.authorized_succeeds"],
    axioms: [],
  },
  { module: "V3", file: "v3", claims: ["Transfer.transfer_safe"], axioms: [] },
  {
    module: "Requirements",
    file: "requirements",
    claims: ["Client.requires_auth"],
    axioms: [],
  },
  {
    module: "Bridge",
    file: "bridge",
    claims: ["Client.requires_auth"],
    axioms: ["Transfer.transfer_safe"],
  },
  {
    module: "Axioms",
    file: "axioms",
    claims: ["Transfer.assumed_safe"],
    axioms: ["Trusted.authorization", "Trusted.evidence"],
  },
  {
    module: "ChangedDefinition",
    file: "changed-definition",
    claims: ["Transfer.transfer_safe"],
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
