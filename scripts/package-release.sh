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

# Tests also build this target with fewer features. Always produce the binary
# we distribute here, regardless of which checks ran immediately beforehand.
cargo build --release --locked -p zklean-native --features prover,execute
bun build --compile src/cli.ts --outfile "$root/bin/zklean"
cp target/release/zklean-native "$root/libexec/zklean-native"
cp crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest "$root/libexec/zklean-guest"
cp .tooling/lean4export/.lake/build/bin/lean4export "$root/libexec/lean4export"
strip "$root/libexec/zklean-native" "$root/libexec/lean4export"

bun src/cli.ts pin \
  --binary "$root/libexec/zklean-native" \
  --elf "$root/libexec/zklean-guest" \
  --out "$root/share/zklean/verifier.json"

chmod 755 "$root/bin/zklean" "$root/libexec/zklean-native" "$root/libexec/lean4export"
chmod 644 "$root/libexec/zklean-guest" "$root/share/zklean/verifier.json"

tar -czf "$output/$archive" -C "$stage" zklean
(cd "$output" && sha256sum "$archive" > "$archive.sha256")
echo "Created $output/$archive"
