#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exporter_dir="${1:-.tooling/lean4export}"
if [ ! -d "$exporter_dir/.git" ]; then
  git init "$exporter_dir"
  git -C "$exporter_dir" remote add origin https://github.com/leanprover/lean4export.git
fi
git -C "$exporter_dir" fetch --depth 1 origin df81913eee5519d5a88ae5b0fd701b5298cc29ab
git -C "$exporter_dir" checkout --detach df81913eee5519d5a88ae5b0fd701b5298cc29ab
(cd "$exporter_dir" && lake build)
