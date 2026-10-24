import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createSourceManifest, loadRequirements } from "../src/requirements.ts";
import { findTools, nativeOptions } from "../src/tooling.ts";
import { binary, buildNative } from "./helpers.ts";

const lake = process.env.ZKLEAN_LAKE;

test("explicit tool and profile paths fail closed instead of falling back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zklean-missing-tools-"));
  try {
    const missing = join(directory, "missing");
    for (const key of ["binary", "elf", "exporter", "lake", "config"])
      await expect(findTools({ [key]: missing })).rejects.toThrow("not found");
    for (const env of [{}, { ZKLEAN_PROFILE: missing }]) {
      const child = Bun.spawn(
        [
          process.execPath,
          "src/cli.ts",
          "verify",
          "--certificate",
          "tests/fixtures/identity.certificate.json",
          ...(Object.keys(env).length ? [] : ["--config", missing]),
        ],
        { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" },
      );
      expect(await child.exited).toBe(1);
      expect(await new Response(child.stderr).text()).toContain(
        "verifier profile not found",
      );
      expect(await new Response(child.stdout).text()).toBe("");
    }
    const profile = await Bun.file(
      join(import.meta.dir, "fixtures/identity.verifier.json"),
    ).json();
    const config = join(directory, "profile.json");
    for (const fields of [
      { format: "unknown" },
      { sp1Version: "6.0.0" },
      { timeout: "86400000" },
      { timeout: 0 },
      { veriferKey: profile.verifierKey },
    ]) {
      await Bun.write(config, JSON.stringify({ ...profile, ...fields }));
      await expect(
        nativeOptions({ ...(await findTools()), config }, false),
      ).rejects.toThrow("verifier profile");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.skipIf(!lake)(
  "source changes after export cannot bless an older requirement snapshot",
  async () => {
    await buildNative();
    const directory = await mkdtemp(
      join(tmpdir(), "zklean-requirement-transaction-"),
    );
    try {
      await Bun.write(
        join(directory, "lean-toolchain"),
        "leanprover/lean4:v4.36.0-rc1\n",
      );
      await Bun.write(
        join(directory, "lakefile.toml"),
        'name = "Transaction"\n[[lean_lib]]\nname = "Transaction"\nroots = ["Remote"]\n',
      );
      const source = join(directory, "Remote.lean");
      await Bun.write(
        source,
        "prelude\naxiom Remote.required : ∀ P : Prop, P → P\n",
      );
      const output = `${source}.zklean.json`;
      await Bun.write(output, "preserve existing sidecar\n");
      const wrapper = join(directory, "native.ts");
      await Bun.write(
        wrapper,
        `#!${process.execPath}\nimport {writeFileSync} from "node:fs";\nif (process.argv[2] === "requirements") writeFileSync(${JSON.stringify(source)}, "prelude\\naxiom Remote.required : ∀ P : Prop, P\\n");\nconst child=Bun.spawnSync([${JSON.stringify(binary)}, ...process.argv.slice(2)], {stdin:"inherit", stdout:"inherit", stderr:"inherit"});\nprocess.exit(child.exitCode);\n`,
      );
      await chmod(wrapper, 0o755);
      const child = Bun.spawn(
        [
          process.execPath,
          "src/cli.ts",
          "requirements",
          "--project",
          directory,
          "--module",
          "Remote",
          "--claims",
          "Remote.required",
          "--binary",
          wrapper,
          "--out",
          output,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await child.exited).toBe(1);
      expect(await new Response(child.stderr).text()).toContain(
        "sources changed during requirements generation",
      );
      expect(await Bun.file(output).text()).toBe("preserve existing sidecar\n");
      const unbound = Bun.spawn(
        [
          process.execPath,
          "src/cli.ts",
          "requirements",
          "--export",
          "tests/fixtures/identity.ndjson",
          "--source",
          source,
          "--claims",
          "Demo.identity",
          "--out",
          output,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await unbound.exited).toBe(1);
      expect(await new Response(unbound.stderr).text()).toContain(
        "source-bound requirements",
      );
      expect(await Bun.file(output).text()).toBe("preserve existing sidecar\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);

test.skipIf(!lake)(
  "requirements resolve srcDir and reject stale transitive source edits before a rebuild",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "zklean-srcdir-"));
    try {
      await Bun.write(
        join(directory, "lakefile.toml"),
        'name = "SourceLayout"\n[[lean_lib]]\nname = "SourceLayout"\nsrcDir = "src"\nroots = ["Base", "Remote"]\n',
      );
      await Bun.write(
        join(directory, "lean-toolchain"),
        "leanprover/lean4:v4.36.0-rc1\n",
      );
      const imported = join(directory, "src/Base.lean");
      await Bun.write(
        imported,
        "prelude\ndef Base.marker : Prop := ∀ P : Prop, P → P\n",
      );
      const source = join(directory, "src/Remote.lean");
      await Bun.write(
        source,
        "prelude\nimport Base\naxiom Remote.required : Base.marker\n",
      );
      const child = Bun.spawn(
        [
          process.execPath,
          "src/cli.ts",
          "requirements",
          "--project",
          directory,
          "--module",
          "Remote",
          "--claims",
          "Remote.required",
          "--out",
          `${source}.zklean.json`,
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, ZKLEAN_LAKE: lake! },
        },
      );
      const stderr = await new Response(child.stderr).text();
      if ((await child.exited) !== 0) throw new Error(stderr);
      const snapshot = await Bun.file(`${source}.zklean.json`).json();
      expect(snapshot.sourceManifest.files["Base.lean"]).toMatch(
        /^[0-9a-f]{64}$/,
      );
      await expect(loadRequirements(source)).resolves.toHaveProperty("specs");
      await Bun.write(
        imported,
        "prelude\ndef Base.marker : Prop := ∀ P : Prop, P\n",
      );
      await expect(loadRequirements(source)).rejects.toThrow("stale");
    } finally {
      await rm(directory, { recursive: true });
    }
  },
  60_000,
);

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
        `${source}.zklean.json`,
        JSON.stringify({
          format: "zklean/requirements/1",
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
