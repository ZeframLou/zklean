#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

output="${1:-dist}"
platform="linux-x64"
archive="zklean-$platform.tar.gz"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
root="$stage/zklean"
mkdir -p "$root/bin" "$root/libexec" "$root/share/zklean" "$output"

bun build --compile src/cli.ts --outfile "$root/bin/zklean"
cp target/release/zklean-native "$root/libexec/zklean-native"
cp crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest "$root/libexec/zklean-guest"
cp .tooling/lean4export/.lake/build/bin/lean4export "$root/libexec/lean4export"
cp -a "$(lean --print-prefix)" "$root/libexec/lean"
strip "$root/libexec/zklean-native" "$root/libexec/lean4export"

bun src/cli.ts pin \
  --binary "$root/libexec/zklean-native" \
  --elf "$root/libexec/zklean-guest" \
  --out "$root/share/zklean/verifier.json"

tar -czf "$output/$archive" -C "$stage" zklean
(cd "$output" && sha256sum "$archive" > "$archive.sha256")
echo "Created $output/$archive"
