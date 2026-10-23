# Development

Build from the repository root with Bun 1.4.4, stable Rust, the
[SP1 5.2.4 toolchain](https://github.com/succinctlabs/sp1/tree/v5.2.4),
and [Lean 4.36.0-rc1](https://github.com/leanprover/lean4/releases/tag/v4.36.0-rc1)
installed. Make `bun`, `cargo`, `cargo prove`, and `lake` available on `PATH`.
Rust 1.91.1 is also required by the guest build:

```sh
rustup toolchain install 1.91.1 --profile minimal
bun install --frozen-lockfile
bash scripts/prepare-sp1.sh
bash scripts/build-guest.sh
cargo build --release --locked -p zklean-native --features execute
bash scripts/setup-exporter.sh
bun src/cli.ts pin --out examples/generated/verifier.json
```

Run the checks, including execution of the guest and Lean source checks:

```sh
cargo fmt --check -p zklean-core -p zklean-native
cargo clippy --locked -p zklean-native -- -D warnings
ZKLEAN_LAKE="$(command -v lake)" \
  ZKLEAN_GUEST_ELF="$PWD/crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest" \
  bun run check
```

During development, run the CLI with `bun src/cli.ts`. To build and install the
standalone CLI instead:

```sh
bash scripts/package-release.sh dist
ZKLEAN_RELEASE_BASE="file://$PWD/dist" sh install.sh
export PATH="$HOME/.local/bin:$PATH"
```
