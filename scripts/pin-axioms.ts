/** Regenerate standard axiom pins from the pinned Lean exporter and checker. */
import { resolve } from "node:path";
import { declarationIdentity, readModel, runNative } from "../src/index.ts";
import { exportModule, findTools } from "../src/tooling.ts";

const tools = await findTools();
const exported = await exportModule({
  project: resolve("examples/lean"),
  module: "AxiomPolicy",
  claims: [
    "AxiomPolicy.ext",
    "AxiomPolicy.choice_used",
    "AxiomPolicy.quotient",
  ],
  tools,
});
const statement = (await runNative(tools.binary, "check", {
  export: exported,
  claims: [
    "AxiomPolicy.ext",
    "AxiomPolicy.choice_used",
    "AxiomPolicy.quotient",
  ],
  allowedAxioms: ["propext", "Classical.choice", "Quot.sound"],
})) as { specs: import("../src/types.ts").Specs; axioms: string[] };
const model = readModel(statement.specs);
await Bun.write(
  "src/axioms.json",
  JSON.stringify(
    Object.fromEntries(
      statement.axioms.map((name) => [name, declarationIdentity(model, name)]),
    ),
    null,
    2,
  ) + "\n",
);
