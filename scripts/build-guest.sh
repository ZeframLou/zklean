#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../crates/guest"
# SP1 5.2.4's compiler is based on Rust 1.91.1. Newer Cargo versions can
# pass compiler flags it does not support, so pin Cargo as well as rustc.
cargo +1.91.1 prove build
