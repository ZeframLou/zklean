import { object, parseSpecs, readModel, sha256 } from "./encoding.ts";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Requirements, SourceManifest } from "./types.ts";
import { runLake } from "./lean.ts";

async function hashFile(path: string): Promise<string> {
  return sha256(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

async function projectRoot(source: string): Promise<string> {
  let directory = dirname(resolve(source));
  while (true) {
    if (
      (await Bun.file(join(directory, "lakefile.toml")).exists()) ||
      (await Bun.file(join(directory, "lakefile.lean")).exists())
    )
      return directory;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Lean source is not inside a Lake project");
    directory = parent;
  }
}

/** Capture the source and built dependency closure reported by Lean. */
export async function createSourceManifest(
  source: string,
  lake = "lake",
  includeArtifacts = true,
): Promise<SourceManifest> {
  const sourcePath = resolve(source);
  const root = await projectRoot(sourcePath);
  const paths = new Set<string>([sourcePath]);
  for (const name of [
    "lean-toolchain",
    "lakefile.toml",
    "lakefile.lean",
    "lake-manifest.json",
  ]) {
    const path = join(root, name);
    if (await Bun.file(path).exists()) paths.add(path);
  }
  // Lean resolves sources itself: .olean paths do not reveal a library's srcDir.
  const pending = [sourcePath];
  const visited = new Set<string>();
  while (pending.length) {
    const batch = pending.splice(0, 8).filter((path) => {
      if (visited.has(path)) return false;
      visited.add(path);
      return true;
    });
    await Promise.all(
      batch.map(async (current) => {
        const sources = await runLake(root, lake, [
          "env",
          "lean",
          "--src-deps",
          relative(root, current),
        ]);
        for (const line of sources.split(/\r?\n/).filter(Boolean)) {
          const path = resolve(root, line);
          paths.add(path);
          pending.push(path);
        }
        if (includeArtifacts) {
          const artifacts = await runLake(root, lake, [
            "env",
            "lean",
            "--deps",
            relative(root, current),
          ]);
          for (const line of artifacts.split(/\r?\n/).filter(Boolean))
            paths.add(resolve(root, line));
        }
      }),
    );
  }
  const base = dirname(sourcePath);
  const files: Record<string, string> = {};
  for (const path of [...paths].sort()) {
    const key = relative(base, path).replaceAll("\\", "/") || ".";
    files[key] = await hashFile(path);
  }
  return { format: "zklean/source-manifest/1", files };
}

async function validateSourceManifest(
  source: string,
  value: unknown,
): Promise<void> {
  const manifest = object(value);
  if (
    manifest.format !== "zklean/source-manifest/1" ||
    Object.keys(manifest).sort().join(",") !== "files,format"
  )
    throw new Error("invalid Lean source manifest");
  const files = object(manifest.files);
  const sourceName = relative(dirname(source), source).replaceAll("\\", "/");
  if (!Object.hasOwn(files, sourceName) || Object.keys(files).length === 0)
    throw new Error("source manifest does not include the Lean source");
  for (const [path, expected] of Object.entries(files)) {
    if (
      !path ||
      isAbsolute(path) ||
      typeof expected !== "string" ||
      !/^[0-9a-f]{64}$/.test(expected)
    )
      throw new Error("invalid Lean source manifest entry");
    if ((await hashFile(resolve(dirname(source), path))) !== expected)
      throw new Error("Lean requirements sidecar is stale; regenerate it");
  }
}

export async function loadRequirements(
  input: Requirements | string,
): Promise<Requirements> {
  let value: unknown = input;
  if (typeof input === "string") {
    const isLean = input.endsWith(".lean");
    value = await Bun.file(isLean ? `${input}.zklean.json` : input).json();
    if (isLean) {
      await validateSourceManifest(
        resolve(input),
        object(value).sourceManifest,
      );
    }
  }
  const r = object(value);
  if (
    r.format !== "zklean/requirements/1" ||
    Object.keys(r).some(
      (k) => !["format", "specs", "sourceManifest"].includes(k),
    )
  ) {
    throw new Error("invalid requirements format");
  }
  const specs = parseSpecs(r.specs);
  readModel(specs);
  return structuredClone({ format: r.format, specs });
}
