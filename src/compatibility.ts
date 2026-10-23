import {
  canonical,
  object,
  parseSpecs,
  readModel,
  sha256,
} from "./encoding.ts";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  Certificate,
  PublicModel,
  Requirements,
  SourceManifest,
  Specs,
} from "./types.ts";

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
  const child = Bun.spawn(
    [lake, "env", "lean", "--deps", relative(root, sourcePath)],
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
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const artifact = resolve(line);
    const marker = `${join(".lake", "build", "lib", "lean")}/`;
    const normalized = artifact.replaceAll("\\", "/");
    const index = normalized.lastIndexOf(`/${marker}`);
    let dependency = artifact;
    if (index >= 0 && normalized.endsWith(".olean")) {
      const base = normalized.slice(0, index);
      const module = normalized.slice(
        index + marker.length + 1,
        -".olean".length,
      );
      const candidate = join(base, `${module}.lean`);
      if (await Bun.file(candidate).exists()) dependency = candidate;
    }
    paths.add(dependency);
  }
  const base = dirname(sourcePath);
  const files: Record<string, string> = {};
  for (const path of [...paths].sort()) {
    const key = relative(base, path).replaceAll("\\", "/") || ".";
    files[key] = await hashFile(path);
  }
  return { format: "httpv/source-manifest/1", files };
}

async function validateSourceManifest(
  source: string,
  value: unknown,
): Promise<void> {
  const manifest = object(value);
  if (
    manifest.format !== "httpv/source-manifest/1" ||
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
    value = await Bun.file(isLean ? `${input}.httpv.json` : input).json();
    if (isLean) {
      await validateSourceManifest(
        resolve(input),
        object(value).sourceManifest,
      );
    }
  }
  const r = object(value);
  if (
    r.format !== "httpv/requirements/1" ||
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

/** Compare both the types and every resolved definition in their public closure.
 * Declaration names alone never establish compatibility. Proof bodies have
 * already been removed by the guest, so theorem/axiom roles can be compared. */
function declaration(model: PublicModel, name: string): string | undefined {
  const entry = model.declarations[name];
  if (!entry) return undefined;
  const kind = Object.keys(entry)[0];
  if (!kind) return undefined;
  const data = entry[kind]!;
  if (kind === "thm" || kind === "axiom") {
    return canonical({
      proposition: {
        name: data.name,
        levelParams: data.levelParams,
        type: data.type,
      },
    });
  }
  return canonical(entry);
}
function includesContext(actual: PublicModel, required: PublicModel): boolean {
  return Object.keys(required.declarations).every(
    (name) => declaration(actual, name) === declaration(required, name),
  );
}
export function exactMatch(remote: Certificate, requirements: Specs): boolean {
  return (
    requirements.claims.every((name) => remote.specs.claims.includes(name)) &&
    includesContext(readModel(remote.specs), readModel(requirements))
  );
}

/** A bridge is an independently checked Lean proof of the required propositions
 * in an environment where the remote certified propositions may be axioms.
 * Checking every shared definition prevents reinterpreting a named guarantee. */
export function validBridge(
  remote: Certificate,
  requirements: Specs,
  bridge: Certificate,
): boolean {
  const model = readModel(bridge.specs);
  const advertised = readModel(remote.specs);
  const assumed = bridge.axioms.filter((name) =>
    remote.specs.claims.includes(name),
  );
  return (
    requirements.claims.every((name) => bridge.specs.claims.includes(name)) &&
    includesContext(model, readModel(requirements)) &&
    assumed.every(
      (name) => declaration(model, name) === declaration(advertised, name),
    ) &&
    Object.keys(model.declarations)
      .filter((name) => Object.hasOwn(advertised.declarations, name))
      .every(
        (name) => declaration(model, name) === declaration(advertised, name),
      )
  );
}
