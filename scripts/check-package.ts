/** Verify the files consumers receive, with no native verifier available. */
import { mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "zklean-npm-"));
async function run(command: string[], cwd = temporary, isolated = false) {
  const child = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      npm_config_cache: join(temporary, "npm-cache"),
      ...(isolated
        ? {
            PATH: "/no-native-tools",
            ZKLEAN_NATIVE: "/no-native-verifier",
            ZKLEAN_PROFILE: "/no-native-profile",
          }
        : {}),
    },
  });
  const text = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`${command[0]} failed`);
  return text;
}
try {
  const packed = JSON.parse(
    await run(["npm", "pack", "--json", "--pack-destination", temporary], root),
  ) as { filename: string }[];
  await run([
    "npm",
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(temporary, packed[0]!.filename),
  ]);
  await copyFile(
    join(root, "tests/fixtures/identity.certificate.json"),
    join(temporary, "certificate.json"),
  );
  await Bun.write(
    join(temporary, "consumer.ts"),
    `
import { createVerifier } from "zklean";
const result = await createVerifier().verify(await Bun.file("certificate.json").json(), { allowedAxioms: [] });
if (result.status !== "verified") throw new Error(JSON.stringify(result));
console.log("Packed npm SDK verified a real proof without native tools.");
`,
  );
  console.log(
    (await run([process.execPath, "consumer.ts"], temporary, true)).trim(),
  );
  const result = JSON.parse(
    await run(
      [
        join(root, "dist/zklean"),
        "verify",
        "--certificate",
        join(temporary, "certificate.json"),
      ],
      temporary,
      true,
    ),
  );
  if (result.status !== "verified") throw new Error(JSON.stringify(result));
  console.log("Compiled CLI verified a real proof without native tools.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
