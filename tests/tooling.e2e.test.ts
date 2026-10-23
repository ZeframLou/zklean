import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  createSourceManifest,
  loadRequirements,
} from "../src/compatibility.ts";

const lake = process.env.ZKLEAN_LAKE;

test.skipIf(!lake)(
  "Lean manifests detect transitive source and toolchain changes",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "zklean-manifest-"));
    try {
      await Bun.write(
        join(directory, "lakefile.toml"),
        'name = "ManifestTest"\ndefaultTargets = ["ManifestTest"]\n[[lean_lib]]\nname = "ManifestTest"\nroots = ["Base", "Middle", "Remote"]\n',
      );
      const toolchain = "leanprover/lean4:v4.36.0-rc1\n";
      await Bun.write(join(directory, "lean-toolchain"), toolchain);
      const base = "prelude\ndef Base.marker : Prop := ∀ P : Prop, P → P\n";
      await Bun.write(join(directory, "Base.lean"), base);
      await Bun.write(
        join(directory, "Middle.lean"),
        "prelude\nimport Base\ndef Middle.marker : Prop := Base.marker\n",
      );
      const source = join(directory, "Remote.lean");
      await Bun.write(
        source,
        "prelude\nimport Middle\naxiom Remote.required : Middle.marker\n",
      );
      const child = Bun.spawn([lake!, "build"], {
        cwd: directory,
        env: {
          ...process.env,
          ELAN_TOOLCHAIN: "leanprover/lean4:v4.36.0-rc1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      const manifest = await createSourceManifest(source, lake!);
      for (const name of [
        "Base.lean",
        "Middle.lean",
        "Remote.lean",
        "lean-toolchain",
      ])
        expect(manifest.files[name]).toMatch(/^[0-9a-f]{64}$/);
      const { specs } = await Bun.file(
        join(import.meta.dir, "fixtures/identity.certificate.json"),
      ).json();
      await Bun.write(
        `${source}.httpv.json`,
        JSON.stringify({
          format: "httpv/requirements/1",
          specs,
          sourceManifest: manifest,
        }),
      );
      expect((await loadRequirements(source)).specs).toEqual(specs);
      await Bun.write(join(directory, "Base.lean"), `${base}-- changed\n`);
      await expect(loadRequirements(source)).rejects.toThrow("stale");
      await Bun.write(join(directory, "Base.lean"), base);
      await Bun.write(
        join(directory, "lean-toolchain"),
        `${toolchain}-- changed\n`,
      );
      await expect(loadRequirements(source)).rejects.toThrow("stale");
    } finally {
      await rm(directory, { recursive: true });
    }
  },
  60_000,
);
