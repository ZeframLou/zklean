#!/usr/bin/env bash
set -euo pipefail
# Use only the unmodified upstream ceremony artifacts, pinned by archive digest.
root="${SP1_GROTH16_CIRCUIT_PATH:-$HOME/.sp1/circuits/groth16}/v5.0.0"
digest=6cbc2c155c41001e81efd81119bd3d4f32313fcd3184df383d50225315b73104
temporary="$(mktemp)"
trap 'rm -f "$temporary"' EXIT
curl -fsSL "${ZKLEAN_CIRCUIT_URL:-https://sp1-circuits.s3-us-east-2.amazonaws.com/v5.0.0-groth16.tar.gz}" -o "$temporary"
printf '%s  %s\n' "$digest" "$temporary" | sha256sum -c -
mkdir -p "$root"
tar -xzf "$temporary" -C "$root"
printf '%s\n' "$digest" > "$root/.archive-sha256"
