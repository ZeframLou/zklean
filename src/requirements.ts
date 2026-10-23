import { object, parseSpecs, readModel, sha256 } from "./encoding.ts";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Requirements, SourceManifest } from "./types.ts";

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
  // --deps reports direct imports. Follow project/package sources recursively;
  // keep binary artifacts as well so build output and toolchain changes fail closed.
  const pending = [sourcePath];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const child = Bun.spawn(
      [lake, "env", "lean", "--deps", relative(root, current)],
      {
        cwd: root,
        env: {
          ...process.env,
          ELAN_TOOLCHAIN: "leanprover/lean4:v4.36.0-rc1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code !== 0)
      throw new Error(
        `could not resolve Lean dependencies: ${stderr.slice(-2000)}`,
      );
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      const artifact = resolve(root, line);
      paths.add(artifact);
      const marker = "/.lake/build/lib/lean/";
      const normalized = artifact.replaceAll("\\", "/");
      const index = normalized.lastIndexOf(marker);
      if (index < 0 || !normalized.endsWith(".olean")) continue;
      const candidate = join(
        normalized.slice(0, index),
        `${normalized.slice(index + marker.length, -".olean".length)}.lean`,
      );
      if (await Bun.file(candidate).exists()) {
        paths.add(candidate);
        pending.push(candidate);
      }
    }
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
