#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exporter_dir="${1:-.tooling/lean4export}"
if [ ! -d "$exporter_dir/.git" ]; then
  git init "$exporter_dir"
  git -C "$exporter_dir" remote add origin https://github.com/leanprover/lean4export.git
fi
git -C "$exporter_dir" fetch --depth 1 origin 5a9a355dc6c5fd82b69058d433e2ae2e8dfbf8fe
git -C "$exporter_dir" checkout --detach 5a9a355dc6c5fd82b69058d433e2ae2e8dfbf8fe
(cd "$exporter_dir" && lake build)
