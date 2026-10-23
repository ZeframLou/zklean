#!/bin/sh
set -eu

repository="${ZKLEAN_REPOSITORY:-ZeframLou/zklean}"
version="${ZKLEAN_VERSION:-latest}"
prefix="${ZKLEAN_PREFIX:-$HOME/.local}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform="linux-x64" ;;
  *)
    echo "ZKLean currently provides a self-contained release for Linux x86_64." >&2
    exit 1
    ;;
esac

asset="zklean-${platform}.tar.gz"
if [ -n "${ZKLEAN_RELEASE_BASE:-}" ]; then
  base="$ZKLEAN_RELEASE_BASE"
elif [ "$version" = latest ]; then
  base="https://github.com/${repository}/releases/latest/download"
else
  base="https://github.com/${repository}/releases/download/${version}"
fi

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
if [ -z "${ZKLEAN_RELEASE_BASE:-}" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if [ "$version" = latest ]; then
    gh release download --repo "$repository" --pattern "$asset" --pattern "$asset.sha256" --dir "$temporary"
  else
    gh release download "$version" --repo "$repository" --pattern "$asset" --pattern "$asset.sha256" --dir "$temporary"
  fi
else
  curl -fsSL "$base/$asset" -o "$temporary/$asset"
  curl -fsSL "$base/$asset.sha256" -o "$temporary/$asset.sha256"
fi
(cd "$temporary" && sha256sum -c "$asset.sha256")
tar -xzf "$temporary/$asset" -C "$temporary"

mkdir -p "$prefix/bin" "$prefix/libexec" "$prefix/share/zklean"
cp "$temporary/zklean/bin/zklean" "$prefix/bin/zklean"
cp "$temporary/zklean/libexec/zklean-native" "$prefix/libexec/zklean-native"
cp "$temporary/zklean/libexec/zklean-guest" "$prefix/libexec/zklean-guest"
cp "$temporary/zklean/libexec/lean4export" "$prefix/libexec/lean4export"
cp "$temporary/zklean/share/zklean/verifier.json" "$prefix/share/zklean/verifier.json"
chmod 755 "$prefix/bin/zklean" "$prefix/libexec/zklean-native" "$prefix/libexec/lean4export"
chmod 644 "$prefix/libexec/zklean-guest" "$prefix/share/zklean/verifier.json"

if [ "${ZKLEAN_SKIP_LEAN:-0}" != 1 ]; then
  elan_home="${ELAN_HOME:-$HOME/.elan}"
  if [ ! -x "$elan_home/bin/elan" ]; then
    curl -fsSL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -o "$temporary/elan-init.sh"
    sh "$temporary/elan-init.sh" -y --no-modify-path --default-toolchain leanprover/lean4:v4.36.0-rc1
  else
    "$elan_home/bin/elan" toolchain install leanprover/lean4:v4.36.0-rc1
  fi
fi

echo "Installed ZKLean in $prefix"
case ":$PATH:" in
  *":$prefix/bin:"*) ;;
  *) echo "Add $prefix/bin to PATH, then run: zklean doctor" ;;
esac
