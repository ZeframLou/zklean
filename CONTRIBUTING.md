# Contributing

## Tools

Bun 1.4.4, stable Rust and Rust 1.91.1, the
[SP1 5.2.4 toolchain](https://github.com/succinctlabs/sp1/tree/v5.2.4)
(`cargo prove`), [Lean 4.36.0-rc1](https://github.com/leanprover/lean4/releases/tag/v4.36.0-rc1)
with Lake, and, for proving, Go 1.23 and a C compiler.

```sh
rustup toolchain install 1.91.1 --profile minimal --target wasm32-unknown-unknown
bun install --frozen-lockfile
bash scripts/prepare-sp1.sh       # checksum-pinned SP1 recursion key map
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
Rust 1.91.1 with remapped paths) and requires it to equal `src/verifier.wasm`,
re-exports the Lean fixtures and requires them unchanged, and builds the guest.
As with the guest, CI's Linux build of the verifier is canonical: after changing
`crates/verifier`, commit the `zklean-verifier-wasm` artifact CI uploads.

## The guest and its key

`crates/guest` runs `zklean_core::check` inside SP1. Its verifier key depends on
the exact ELF, and Cargo hashes package paths into the build, so
`scripts/build-guest.sh` builds from a fixed path. The canonical ELF is the one
CI's guest job uploads as the `zklean-guest-elf` artifact; `zklean pin` derives
`src/guest.json` from it. Any change to `crates/core` or `vendor/nanoda` changes
the key and invalidates `tests/fixtures/identity.certificate.json`.

To re-prove that certificate, build the prover with
`GOFLAGS=-buildvcs=false cargo build --release --locked -p zklean-native --features prover,execute`,
fetch the SP1 circuits with `bash scripts/setup-circuits.sh` (2.9 GB), and run
`zklean prove` on `tests/fixtures/identity.ndjson` with `ZKLEAN_GUEST_ELF` set to
the CI ELF. `RAYON_NUM_THREADS`, `GOMAXPROCS`, `GOMEMLIMIT=6GiB` and `GOGC=20`
bound memory to about 8 GB.

Nanoda is vendored with visibility-only changes; see `vendor/nanoda/UPSTREAM.md`.
