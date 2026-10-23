# Development

Build from the repository root with Bun 1.4.4, stable Rust, the
[SP1 5.2.4 toolchain](https://github.com/succinctlabs/sp1/tree/v5.2.4),
and [Lean 4.36.0-rc1](https://github.com/leanprover/lean4/releases/tag/v4.36.0-rc1)
installed, plus Go 1.23.12, a C compiler, and libclang development headers for the
native prover build. Make `bun`, `cargo`, `cargo prove`, and `lake` available on `PATH`.
Rust 1.91.1 is also required by the guest build:

```sh
rustup toolchain install 1.91.1 --profile minimal
bun install --frozen-lockfile
bash scripts/prepare-sp1.sh
bash scripts/build-guest.sh
GOFLAGS=-buildvcs=false cargo build --release --locked -p zklean-native --features prover,execute
bash scripts/setup-circuits.sh
rustup target add wasm32-unknown-unknown
bun run build:verifier
bash scripts/setup-exporter.sh
bun src/cli.ts pin --out examples/generated/verifier.json
```

Run the checks, including execution of the guest and Lean source checks:

```sh
cargo fmt --check -p zklean-core -p zklean-native -p zklean-verifier
cargo clippy --locked -p zklean-native -p zklean-verifier -- -D warnings
ZKLEAN_LAKE="$(command -v lake)" \
  ZKLEAN_GUEST_ELF="$PWD/crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest" \
  bun run check
bun run format:check
bun run compile
bun scripts/check-package.ts
```

During development, run the CLI with `bun src/cli.ts`. To build and install the
standalone CLI instead:

```sh
bash scripts/package-release.sh dist
ZKLEAN_RELEASE_BASE="file://$PWD/dist" sh install.sh
export PATH="$HOME/.local/bin:$PATH"
```

See [Distribution](DISTRIBUTION.md) for a clean Linux baseline test and preparing
the separate binary-only release host. Building on a newer distribution can
produce binaries requiring a newer glibc; the release workflow builds on Ubuntu
22.04 and tests the actual archive in a clean container.

The `prover` feature links Go's gnark library into the native executable. In a
source archive without Git metadata, use `GOFLAGS=-buildvcs=false` to disable
Go's optional VCS stamping. If bindgen cannot locate standard C headers, install
the matching libclang development package or set `BINDGEN_EXTRA_CLANG_ARGS` to
the compiler's include directory. Neither workaround changes upstream SP1.

`SP1_GROTH16_CIRCUIT_PATH` selects the proving-data root; SP1 appends `v5.0.0`.
The setup script downloads a 2.9 GB archive, checks its fixed SHA-256, and extracts
the official circuit and proving key. Verification needs none of these files.
An alternative Cargo output directory must include an ancestor named `target`,
as required by SP1 5.2.4's build scripts.

Tests may rebuild `zklean-native` with only verification or guest-execution
features. Rebuild it with `--features prover,execute` before `pin`, `prove`, or
fixture identity checks; `package-release.sh` does this itself.

For local proving, enable the current CPU's vector instructions in a separate
build directory. This changes the host prover, not the pinned guest:

```sh
CARGO_TARGET_DIR=/tmp/zklean-local/target RUSTFLAGS="-C target-cpu=native" \
  cargo build --release --locked -p zklean-native --features prover,execute
ZKLEAN_NATIVE=/tmp/zklean-local/target/release/zklean-native \
  bun src/cli.ts prove --export tests/fixtures/identity.ndjson \
  --claims Demo.identity --out examples/generated/identity.groth16.json
```

Use the default portable Rust build for distribution; it must run on another
machine. The archive uses Bun's baseline x86-64 runtime. For constrained proving
environments, `RAYON_NUM_THREADS`, `GOMAXPROCS`, `GOMEMLIMIT`, and `GOGC` control
host worker counts and Go memory behavior without changing SP1's source or
production circuit checks. These settings do not guarantee that a workload fits
the machine. `RUST_LOG` selects native diagnostics, streamed by `zklean prove`.

To regenerate the real cryptographic fixture, build the current guest and
native prover, run `zklean pin`, prove `tests/fixtures/identity.ndjson`, and
positively verify the result through native and embedded verification before
replacing committed data. `bun scripts/check-proof-fixture.ts GUEST_ELF` checks
the guest identity; the crypto tests check proof acceptance and tampering.
