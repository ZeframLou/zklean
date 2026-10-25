#!/usr/bin/env bash
# Build the embedded WebAssembly verifier reproducibly: a pinned toolchain and
# remapped paths, so CI can require the committed binary to match its source.
set -euo pipefail
cd "$(dirname "$0")/.."
RUSTFLAGS="--remap-path-prefix=$PWD=/zklean --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo" \
  cargo +1.91.1 build --release --locked -p zklean-verifier --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/zklean_verifier.wasm src/verifier.wasm
chmod 644 src/verifier.wasm
