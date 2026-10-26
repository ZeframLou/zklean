# Contributing

## Tools

Bun 1.4.4, stable Rust and Rust 1.96.0, the
[SP1 6.10.0 toolchain](https://github.com/succinctlabs/sp1/tree/v6.10.0)
(`cargo prove`), [Lean 4.35.0](https://github.com/leanprover/lean4/releases/tag/v4.35.0)
with Lake, and, for proving, Go 1.24, `protoc` and a C compiler.

```sh
rustup toolchain install 1.96.0 --profile minimal --target wasm32-unknown-unknown
bun install --frozen-lockfile
bash scripts/setup-exporter.sh    # pinned lean4export
cargo build --release --locked -p zklean-native
```

## Checks

```sh
cargo fmt --check -p zklean-core -p zklean-native -p zklean-verifier
cargo clippy --locked -p zklean-core -p zklean-native -p zklean-verifier -- -D warnings
bun run format:check
ZKLEAN_LAKE="$(command -v lake)" bun run check
```

CI also rebuilds the WebAssembly verifier (`bun run build:verifier`, pinned to
Rust 1.96.0 with remapped paths) and requires it to equal `src/verifier.wasm`,
re-exports the Lean fixtures and re-derives the pinned identities of Lean's own
definitions (`bun scripts/pin.ts`), requiring both unchanged, and builds the
guest.
As with the guest, CI's Linux build of the verifier is canonical: after changing
`crates/verifier`, commit the `zklean-verifier-wasm` artifact CI uploads.

## The guest and its key

`crates/guest` runs `zklean_core::check` inside SP1. Its verifier key depends on
the exact ELF, and Cargo hashes package paths into the build, so
`scripts/build-guest.sh` builds from a fixed path, on Linux. CI's guest job
builds the canonical ELF and uploads it as the `zklean-guest-elf` artifact;
`zklean pin` derives `src/guest.json` from it, and CI requires the two to agree.
Any change to `crates/core` or `vendor/nanoda` changes the key and invalidates
`tests/fixtures/identity.certificate.json`.

To prove, build the prover in its own directory, since the tests rebuild
`target/release` without features:

```sh
GOFLAGS=-buildvcs=false cargo build --release --locked -p zklean-native \
  --features prover,execute --target-dir target/prover
export ZKLEAN_NATIVE="$PWD/target/prover/release/zklean-native"
export ZKLEAN_GUEST_ELF=/path/to/zklean-guest   # the CI artifact
```

The same two variables run `tests/guest.e2e.test.ts`.

## Releases

1. Set `version` in `package.json`, pin `src/guest.json` from CI's guest
   artifact, and re-prove the identity certificate against the tag's source:

   ```sh
   bun src/cli.ts prove --export tests/fixtures/identity.ndjson \
     --claims Demo.identity --out tests/fixtures/identity.certificate.json \
     --source https://raw.githubusercontent.com/ZeframLou/zklean/vX.Y.Z/tests/fixtures/identity.ndjson
   rm tests/fixtures/identity.certificate.ndjson
   ```

2. Commit, wait for CI to pass, then tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
   The release workflow rebuilds the guest, requires it to match `src/guest.json`
   and attaches it to the GitHub release.
3. Publish the SDK: `npm publish`.

Nanoda is vendored with visibility-only changes; see `vendor/nanoda/UPSTREAM.md`.
