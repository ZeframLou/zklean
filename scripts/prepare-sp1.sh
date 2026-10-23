#!/usr/bin/env bash
# The crates.io package omits this source-release asset. Fetch its exact pinned
# bytes from GitHub so the SDK build needs no S3 access. No keys are generated.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo fetch --locked
map_path=$(cargo metadata --locked --all-features --format-version 1 | python3 -c 'import json,sys,pathlib; p=next(p for p in json.load(sys.stdin)["packages"] if p["name"]=="sp1-prover"); print(pathlib.Path(p["manifest_path"]).parent / "src/vk_map.bin")')
map_temp=$(mktemp)
trap 'rm -f "$map_temp"' EXIT
curl -fsSL https://raw.githubusercontent.com/succinctlabs/sp1/v5.2.4/crates/prover/src/vk_map.bin -o "$map_temp"
python3 - "$map_temp" "$map_path" <<'PY'
import hashlib, pathlib, sys
source, target = map(pathlib.Path, sys.argv[1:])
data = source.read_bytes()
expected = '5e735f6e44f56e9eee91e5626252663afcc5263287d1c5980367b3f9f930a0e8'
if hashlib.sha256(data).hexdigest() != expected:
    raise SystemExit('SP1 recursion VK map checksum mismatch')
target.write_bytes(data)
print('Installed the checksum-pinned SP1 recursion VK map from its source release.')
PY
