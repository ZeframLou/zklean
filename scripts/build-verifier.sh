#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release --locked -p zklean-verifier --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/zklean_verifier.wasm src/verifier.wasm
chmod 644 src/verifier.wasm
