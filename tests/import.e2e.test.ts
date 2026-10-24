import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { leanModule } from "../src/import.ts";
import { declarationIdentity } from "../src/context.ts";
import { readModel } from "../src/encoding.ts";
import { findTools, exportModule } from "../src/tooling.ts";
import { runLake } from "../src/lean.ts";
import { checked, binary } from "./helpers.ts";
import { runNative } from "../src/native.ts";
import type { Certificate } from "../src/types.ts";

test.skipIf(!process.env.ZKLEAN_LAKE)(
  "import preserves control characters and literal escape sequences in kernel strings",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "zklean-import-strings-"));
    try {
      await Bun.write(
        join(directory, "lean-toolchain"),
        "leanprover/lean4:v4.36.0-rc1\n",
      );
      await Bun.write(
        join(directory, "lakefile.toml"),
        'name = "ImportStrings"\n[[lean_lib]]\nname = "ImportStrings"\nroots = ["Control"]\n',
      );
      // Controls use Lean's Unicode escapes; literal backslashes must also survive.
      await Bun.write(
        join(directory, "Control.lean"),
        'import Init.Core\ndef Demo.message : String := "\\u0008\\u000c\\u0000\\u001f\\u007f\\\\b\\\\f\\\"α😀"\ntheorem Demo.message_same : Demo.message = Demo.message := rfl\n',
      );
      const tools = await findTools();
      const exported = await exportModule({
        project: directory,
        module: "Control",
        claims: ["Demo.message_same"],
        tools,
      });
      const statement = (await runNative(binary, "check", {
        export: exported,
        claims: ["Demo.message_same"],
        allowedAxioms: [],
      })) as Certificate;
      await Bun.write(
        join(directory, "Remote.lean"),
        leanModule({ ...statement, proof: "base64:AA==" }),
      );
      await runLake(directory, tools.lake!, ["env", "lean", "Remote.lean"]);
      const source = await Bun.file(
        join(import.meta.dir, "fixtures/identity.ndjson"),
      ).text();
      const binder = 'quote" \\b \\f \b\f\t\n\r\u0000\u001fα😀';
      const renamed = (await runNative(binary, "check", {
        export: source.replace('"str":"h"', `"str":${JSON.stringify(binder)}`),
        claims: ["Demo.identity"],
        allowedAxioms: [],
      })) as Certificate;
      await Bun.write(
        join(directory, "Names.lean"),
        leanModule({ ...renamed, proof: "base64:AA==" }),
      );
      await runLake(directory, tools.lake!, ["env", "lean", "Names.lean"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);

test.skipIf(!process.env.ZKLEAN_LAKE)(
  "a received kernel model supports readable inspection and a new Lean derivation",
  async () => {
    const statement = await checked("v1");
    // This test starts after authentication and exercises model reconstruction.
    const certificate = { ...statement, proof: "base64:AA==" };
    const directory = await mkdtemp(join(tmpdir(), "zklean-import-"));
    try {
      await Bun.write(
        join(directory, "lean-toolchain"),
        "leanprover/lean4:v4.36.0-rc1\n",
      );
      await Bun.write(
        join(directory, "lakefile.toml"),
        'name = "ImportedContract"\n[[lean_lib]]\nname = "ImportedContract"\nroots = ["Remote", "Bridge"]\n',
      );
      await Bun.write(join(directory, "Remote.lean"), leanModule(certificate));
      await Bun.write(
        join(directory, "Bridge.lean"),
        `import Remote

theorem Client.stock_conserved (available requested remaining : Nat) :
    Inventory.POST_reservations available requested = some remaining →
      remaining + requested = available := by
  intro h
  exact (Inventory.reservation_safe available requested remaining h).2.2
`,
      );
      const tools = await findTools();
      const exported = await exportModule({
        project: directory,
        module: "Bridge",
        claims: ["Client.stock_conserved"],
        tools,
      });
      const bridge = (await runNative(binary, "check", {
        export: exported,
        claims: ["Client.stock_conserved"],
        allowedAxioms: ["Inventory.reservation_safe", "propext"],
      })) as Certificate;
      expect(bridge.axioms).toContain("Inventory.reservation_safe");
      expect(
        declarationIdentity(
          readModel(bridge.specs),
          "Inventory.reservation_safe",
        ),
      ).toBe(
        declarationIdentity(
          readModel(statement.specs),
          "Inventory.reservation_safe",
        ),
      );
      await Bun.write(
        join(directory, "Inspect.lean"),
        leanModule(certificate, true),
      );
      const text = await runLake(directory, tools.lake!, [
        "env",
        "lean",
        "Inspect.lean",
      ]);
      expect(text).toContain("theorem Inventory.reservation_safe");
      expect(text).toContain("def Inventory.POST_reservations");
      expect(text).not.toContain("def Nat.");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  300_000,
);

test.skipIf(!process.env.ZKLEAN_LAKE)(
  "import rejects conflicting propositions and reuses an existing proof definition",
  async () => {
    const statement = await checked("identity", ["Demo.identity"]);
    const directory = await mkdtemp(join(tmpdir(), "zklean-import-collision-"));
    try {
      await Bun.write(
        join(directory, "lean-toolchain"),
        "leanprover/lean4:v4.36.0-rc1\n",
      );
      await Bun.write(join(directory, "lakefile.toml"), 'name = "Collision"\n');
      await Bun.write(
        join(directory, "Remote.lean"),
        leanModule({ ...statement, proof: "base64:AA==" }).replace(
          "import Lean",
          "import Lean\naxiom Demo.identity : False",
        ),
      );
      await expect(
        runLake(directory, process.env.ZKLEAN_LAKE!, [
          "env",
          "lean",
          "Remote.lean",
        ]),
      ).rejects.toThrow("ZKLean import collision: Demo.identity");
      await Bun.write(
        join(directory, "Remote.lean"),
        leanModule({ ...statement, proof: "base64:AA==" }).replace(
          "import Lean",
          "import Lean\ndef Demo.identity (P : Prop) : P → P := fun h => h",
        ),
      );
      await runLake(directory, process.env.ZKLEAN_LAKE!, [
        "env",
        "lean",
        "Remote.lean",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
