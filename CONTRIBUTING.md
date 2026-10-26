# Contributing

This guide is for changing ZKLean itself. To check, prove or verify
certificates, see the [usage guide](docs/USAGE.md).

## Tools

- Bun 1.4.4 and [Lean 4.35.0](https://github.com/leanprover/lean4/releases/tag/v4.35.0)
  with Lake.
- Stable Rust for the native tool.
- Rust 1.96.0 for the reproducible WebAssembly verifier.
- The [SP1 6.10.0 toolchain](https://github.com/succinctlabs/sp1/tree/v6.10.0)
  (`cargo prove`) for the guest. Its compiler is based on Rust 1.96.0, so the
  guest build pins that Cargo too.
- For proving: Go 1.24, `protoc` and a C compiler.

```sh
rustup toolchain install 1.96.0 --profile minimal --target wasm32-unknown-unknown
curl -fsSL https://raw.githubusercontent.com/succinctlabs/sp1/v6.10.0/sp1up/sp1up | bash -s -- --version v6.10.0
export PATH="$HOME/.sp1/bin:$PATH"
bun install --frozen-lockfile
bash scripts/setup-exporter.sh    # pinned lean4export
cargo build --release --locked -p zklean-native
```

## Checks

```sh
cargo fmt --check -p zklean-core -p zklean-native -p zklean-verifier
cargo clippy --locked -p zklean-core -p zklean-native -p zklean-verifier -- -D warnings
bun run format:check
bun run check
ZKLEAN_LAKE="$(command -v lake)" bun run check   # with Lake installed: also the Lean export tests
```

CI also re-exports the Lean fixtures and re-derives the pinned identities of
Lean's own definitions (`bun scripts/pin.ts`), requiring both unchanged, and
rebuilds the WebAssembly verifier and the guest (see below).

## The guest and its key

`crates/guest` runs `zklean_core::check` inside SP1. Its verifier key depends on
the exact ELF, and Cargo hashes package paths into the build, so
`scripts/build-guest.sh` builds from a fixed path, on Linux. CI's guest job
builds the canonical ELF and uploads it as the `zklean-guest-elf` artifact;
`zklean pin` derives `src/guest.json` from it, and CI requires the two to agree.
Any change to `crates/core`, `vendor/nanoda`, `crates/guest` or its `Cargo.lock`
changes the key and invalidates
`tests/fixtures/identity.certificate.json`. To build it yourself on Linux, run
`bash scripts/build-guest.sh`.

The WebAssembly verifier is reproducible in the same way:
`bun run build:verifier` uses Rust 1.96.0 and strips local paths from the
build, and CI requires the result to equal `src/verifier.wasm`. CI's Linux build
is canonical: after changing `crates/verifier`, commit the
`zklean-verifier-wasm` artifact CI uploads.

To prove, build the prover in its own directory, since the tests rebuild
`target/release` without features:

```sh
GOFLAGS=-buildvcs=false cargo build --release --locked -p zklean-native \
  --features prover,execute --target-dir target/prover
export ZKLEAN_NATIVE="$PWD/target/prover/release/zklean-native"
export ZKLEAN_GUEST_ELF=/path/to/zklean-guest   # the CI artifact, or a release's zklean-guest
```

With both set, `bun test tests/guest.e2e.test.ts` runs the real guest on every
fixture.

## Releases

1. Set `version` in `package.json`. With `ZKLEAN_NATIVE` set to the prover
   build and `ZKLEAN_GUEST_ELF` to CI's guest artifact, as above, pin
   `src/guest.json` and re-prove the identity certificate, naming the URL the
   tag will serve as its source:

   ```sh
   bun src/cli.ts pin --out src/guest.json
   bun src/cli.ts prove --export tests/fixtures/identity.ndjson \
     --claims Demo.identity --out tests/fixtures/identity.certificate.json \
     --source https://raw.githubusercontent.com/ZeframLou/zklean/vX.Y.Z/tests/fixtures/identity.ndjson
   rm tests/fixtures/identity.certificate.ndjson
   ```

2. Commit, wait for CI to pass, then tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
   The release workflow rebuilds the guest, requires it to match `src/guest.json`
   and attaches it to the GitHub release.
3. Publish the SDK from a clean checkout of the tag: `npm publish`.

Nanoda is vendored with visibility-only changes; see `vendor/nanoda/UPSTREAM.md`.
