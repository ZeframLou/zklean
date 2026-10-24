/** Regenerate standard axiom identities from the pinned Lean exporter and checker. */
import { resolve } from "node:path";
import { runNative } from "../src/index.ts";
import { exportModule, findTools } from "../src/tooling.ts";

const tools = await findTools();
const claims = [
  "AxiomPolicy.ext",
  "AxiomPolicy.choice_used",
  "AxiomPolicy.quotient",
];
const exported = await exportModule({
  project: resolve("examples/lean"),
  module: "AxiomPolicy",
  claims,
  tools,
});
const { axioms } = (await runNative(tools.binary, "check", {
  export: exported,
  claims,
  allowedAxioms: ["propext", "Classical.choice", "Quot.sound"],
})) as { axioms: Record<string, string> };
await Bun.write("src/axioms.json", `${JSON.stringify(axioms, null, 2)}\n`);
