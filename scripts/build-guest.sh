#!/usr/bin/env bash
set -euo pipefail
repository="$(cd "$(dirname "$0")/.." && pwd)"

# Cargo hashes local package paths into crate identities, which changes function
# layout and the SP1 key across checkout locations. Build a fresh source snapshot
# at one canonical path. Keep only compilation output between builds; flock
# serializes concurrent developer/CI builds that share this machine.
build_root=/tmp/zklean-sp1-build-v5.2.4
mkdir -p "$build_root/target"
exec 9>"$build_root/lock"
flock 9
staging="$(mktemp -d "$build_root/staging.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
tar -C "$repository" -cf - \
  Cargo.toml Cargo.lock crates/core crates/cli vendor/nanoda \
  crates/guest/Cargo.toml crates/guest/Cargo.lock crates/guest/src \
  | tar -C "$staging" -xf -
# This directory contains only this script's generated source snapshot.
rm -rf /tmp/zklean-sp1-build-v5.2.4/source
mv "$staging" "$build_root/source"
ln -s "$build_root/target" "$build_root/source/crates/guest/target"
cd "$build_root/source/crates/guest"
# SP1 5.2.4's compiler is based on Rust 1.91.1. Newer Cargo versions can
# pass compiler flags it does not support, so pin Cargo as well as rustc.
cargo +1.91.1 prove build --locked

output="$repository/crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release"
mkdir -p "$output"
cp "$build_root/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest" "$output/zklean-guest"
