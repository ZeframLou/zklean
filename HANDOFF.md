# Handoff

Continue the request: switch ZKLean to Groth16 and resolve the correctness,
security, quality, usability, and documentation issues found in both repositories.
The Groth16 migration is a work checkpoint, not a validated implementation.

## Repositories

| Repository | Branch | Implementation checkpoint |
| --- | --- | --- |
| `ZeframLou/zklean` | `work` | `e1e15af` |
| `ZeframLou/httpv` | `main` | `e094778` |

Local checkouts are `/workspace/zklean` and `/workspace/httpv`. Both repositories
are private. ZKLean's implementation is on `work`; do not resume from its old
default branch. HTTPV still pins SDK commit
`608dd4bc089eeb71a62eba1def407e4f84697cf9` for development, so its working
compressed-proof integration has not yet switched to the new SDK.

## Constraints

- Keep both projects at `0.1.0`. Do not publish packages or releases, create tags,
  merge branches, or change repository visibility as part of this handoff.
- Use upstream SP1 5.2.4 without source modifications or vendoring. The existing
  Nanoda vendor patch is documented separately in `vendor/nanoda/UPSTREAM.md`.
- Keep ZKLean independent of HTTPV. HTTPV imports only ZKLean's public exports;
  it does not generate certificates during request handling.
- HTTPV consumers install from npm. Its private Git pin is development-only.
- Deliver one compact ZKLean installation command with automatic dependencies.
  Do not make consumers download CI artifacts or configure a native verifier.
- Prefer meaningful E2E and formal checks. Keep changes simple; commit and push
  regularly. Read each repository's `AGENTS.md` before editing its documentation.
- README writing: motivation first, define unfamiliar terms, link dependencies,
  and keep the trust model to one paragraph of at most three sentences. Avoid
  apologies, development history, and unnecessary implementation details.

## Completed changes

- `7c8619f`: axiom permissions bind declarations and their complete dependency
  contexts, rather than trusting names. Standard Lean axiom pins are generated
  from the pinned toolchain; custom assumptions require reviewed fingerprints.
  Lake resolves source paths, including `srcDir`, and manifests detect transitive
  source edits before a rebuild.
- `608dd4b`: shared context comparison ignores bound-variable display names and
  binder annotations while retaining constant names, types, and definition bodies.
- `f37a02b`: reconstruct received public kernel models through Lean's public API.
  A real Lean/Nanoda regression derives a weaker stock-conservation property from
  the received reservation guarantee without its original source or proof.
- HTTPV `e094778`: bounded monitor checks, expiring verification, stopped-state
  invalidation, synchronous state callbacks, and `requireVerified()` request
  gating. Its usage guide includes a gated request example. Bridge checks use
  complete remote assumption identities and resolved contexts.
- ZKLean's verifier coalesces concurrent identical checks and bounds independent
  backend work and queue size; cached results still enforce the current policy.

## Groth16 checkpoint

`e1e15af` changes the CPU prover to `.groth16()`. The `prover` Cargo feature links
SP1's native gnark backend so installed users need neither Go nor Docker.
`crates/verifier` wraps the unchanged upstream `sp1-verifier` crate for native
and WebAssembly verification. The npm SDK defaults to the embedded WASM verifier
and a locally trusted checker key; certificates cannot choose either key.

The wire proof is SP1's four-byte circuit selector plus its 256-byte Groth16
proof. The public specification is additional data. The checker key is BN254
`vk.bytes32()`, which differs from the old serialized BabyBear fingerprint.

CLI wiring adds `init`, authenticated `inspect`, and authenticated `import`.
An import writes a Lean module and `<output>.axioms.json` for subsequent bridge
authoring. Kernel reconstruction and inspection passed their E2E test; the full
authenticated import path still needs the real Groth16 fixture.

**No real Groth16 certificate has been generated or positively verified yet.**
The committed identity certificate and verifier profile are still the old
compressed-STARK fixtures. `src/guest.json` contains the BN254 conversion of the
existing checker fingerprint; validate it against a fresh native `identity`
result before trusting the migration. Do not replace a real proof with a mock,
test signature, or manufactured bytes.

## Network blocker

The user saved a configuration allowing full network access. The bound running
environment continued reporting `restricted`, `enforced`, and no custom domains;
actual downloads returned HTTP 403. Verify the policy of the resumed environment
and actual access, rather than assuming the saved configuration has applied.

Required destinations include:

- `sp1-circuits.s3-us-east-2.amazonaws.com`
- `sp1-circuits.s3.us-east-2.amazonaws.com`
- `storage.googleapis.com`, used by a Go module proxy redirect

Use the cloud runtime skill and the supported environment configuration workflow.
Keep the inherited proxy and CA trust; do not bypass the destination policy.

## Resume proving and validation

See `docs/DEVELOPMENT.md` for the source toolchain. The previous workspace has
Bun 1.4.4, Rust stable and 1.91.1, SP1 5.2.4, Lean 4.36.0-rc1, and the exporter.
These paths are conveniences for that workspace, not installation requirements:

```sh
export PATH="/workspace/.tools/go/bin:/workspace/.cargo/bin:/workspace/.sp1/bin:/tmp/zklean-tools/node_modules/.bin:$PATH"
export CARGO_HOME=/workspace/.cargo
export RUSTUP_HOME=/workspace/.rustup
export GOPATH=/workspace/.go
export GOCACHE=/workspace/.cache/go-build
export ZKLEAN_LAKE=/workspace/lean-4.36.0-rc1-linux/bin/lake
export SP1_GROTH16_CIRCUIT_PATH=/workspace/.sp1/circuits/groth16
```

`/usr/bin/go` in that workspace is not the required Go toolchain; use the Go
1.23.12 installation at `/workspace/.tools/go/bin`. Fresh environments must
provision the documented tools. Do not repurpose `HOME` to fix cache permissions.

From the ZKLean root, after network access works:

```sh
bun install --frozen-lockfile
bash scripts/prepare-sp1.sh
bash scripts/build-guest.sh
cargo build --release --locked -p zklean-native --features prover,execute
rustup target add wasm32-unknown-unknown
bun run build:verifier

export ZKLEAN_GUEST_ELF="$PWD/crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest"
bun src/cli.ts pin --elf "$ZKLEAN_GUEST_ELF" \
  --out examples/generated/verifier.json

bun src/cli.ts prove --export tests/fixtures/identity.ndjson \
  --claims Demo.identity --config examples/generated/verifier.json \
  --out examples/generated/identity.groth16.json

bun src/cli.ts verify --certificate examples/generated/identity.groth16.json \
  --config examples/generated/verifier.json
```

The SDK appends its circuit version to `SP1_GROTH16_CIRCUIT_PATH`; supply the root
directory, not an already versioned path. Keep the production VK checks and
fixed recursion/core shapes in `crates/cli/src/sp1.rs` enabled.

Compare the freshly generated key and ELF digest with `src/guest.json`. Update
that file from the actual built checker identity if needed. Only after successful
real verification, replace `tests/fixtures/identity.certificate.json` and
`identity.verifier.json` with the generated certificate and profile. Then run:

```sh
bun scripts/check-proof-fixture.ts "$ZKLEAN_GUEST_ELF"
cargo fmt --check -p zklean-core -p zklean-native -p zklean-verifier
cargo clippy --locked -p zklean-native -p zklean-verifier -- -D warnings
bun run check
bun run format:check
bun run compile
```

The crypto test must accept the real certificate through native, explicit WASM,
and default SDK verification, and reject altered evidence and wrong keys. Add
valid-model tampering coverage, beyond malformed-input rejection. Verify the
compiled CLI and a packed npm consumer with no native verifier installed.

**Build ordering:** test helpers rebuild `zklean-native` without `prover`; guest
tests rebuild it with `execute`. Rebuild with `--features prover` before `pin`,
`prove`, or packaging. Fix the release workflow's ordering or build outputs so
`bun run check` cannot silently replace the binary intended for distribution.

Once root crypto checks pass, commit and push the SDK. Update HTTPV's development
pin and lockfile, copy the real fixture/profile, and migrate its client examples
to the default embedded verifier. Remove native-path/profile discovery and make
its crypto integration test mandatory in CI. Retest the packed consumer path
using npm installation, not a sibling checkout or Git dependency.

## Validation at checkpoint

| Check | Result |
| --- | --- |
| ZKLean full check, including real SP1 guest execution and Lean | 14 pass, 2 fail |
| Failing tests | Crypto fixture acceptance; concurrent real crypto verification |
| Failure cause | Both still consume the legacy compressed-STARK fixture |
| TypeScript, CLI compilation, Rust formatting/clippy | Passed for the checked configurations |
| Embedded verifier rejects invalid evidence from compiled CLI | Passed |
| Native prover build with gnark | Blocked by Go dependency download policy |
| Real Groth16 generation and positive verification | Not performed |
| HTTPV check against its existing SDK pin and native crypto adapter | 17 pass |

Do not skip the two failing root tests or report the Groth16 migration complete
until a real certificate passes them. The native prover configuration has not
finished compiling, and a positive WASM pairing check has not been exercised.

## Remaining review work

1. Finish Groth16 generation, pin validation, tampering checks, and HTTPV migration
   as above. Retest custom axiom policies and independently verified bridges.
2. Finish the certificate-to-Lean authoring guide and a nontrivial bridge example.
   HTTPV's committed example still renames an identical proposition. Explain the
   conservative matching rules: binder renaming works; changed definitions with
   the same name require distinct/versioned contexts. Review importer collisions:
   it currently skips declarations already present in Lean; downstream context
   and axiom checks remain essential.
3. Complete the one-command installer and release distribution. Both source repos
   remain private, while current public install/docs links assume accessibility.
   Prepare a concrete distribution mechanism without exposing source repositories
   or publishing an unrequested release. `release.yml` currently only uploads CI
   artifacts and now targets Ubuntu 22.04; that alone does not solve distribution.
4. Test the actual archive on a clean supported Linux baseline, including Lean
   installation and a real source command. Earlier native binaries required
   GLIBC 2.39. Validate the baseline build and runtime libraries, remove the
   provisioned-runner/skip-Lean blind spot, and fix the build-order issue above.
5. Measure complete certificate sizes and verification cost against direct
   Nanoda checking on small and larger examples. A 260-byte proof does not make
   every full certificate smaller or cheaper. Replace unsupported README claims
   with concrete motivation and link reproducible measurements.
6. Finish both READMEs, usage guides, and specifications. Root encoding/spec docs
   were partly migrated; other material and fixture descriptions still describe
   compressed proofs or native setup. HTTPV's specification must document exact
   matching, monitor expiry/timeouts, synchronous callbacks, request gating, and
   sidecar generation consistently. Keep trust models separate and concise.
7. Expand adversarial/cross-language coverage of model projection, graph closure,
   canonical encoding, and context comparison. These transformations are part of
   the trusted boundary; avoid tests that merely repeat their implementation.

The original request covers all these issues. Successful fixture regeneration
is the first dependency, not the end of the task.
