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
if [ "$version" = latest ]; then
  base="https://github.com/${repository}/releases/latest/download"
else
  base="https://github.com/${repository}/releases/download/${version}"
fi

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
curl -fsSL "$base/$asset" -o "$temporary/$asset"
curl -fsSL "$base/$asset.sha256" -o "$temporary/$asset.sha256"
(cd "$temporary" && sha256sum -c "$asset.sha256")
tar -xzf "$temporary/$asset" -C "$temporary"

mkdir -p "$prefix/bin" "$prefix/libexec/lean" "$prefix/share/zklean"
cp "$temporary/zklean/bin/zklean" "$prefix/bin/zklean"
cp "$temporary/zklean/libexec/zklean-native" "$prefix/libexec/zklean-native"
cp "$temporary/zklean/libexec/zklean-guest" "$prefix/libexec/zklean-guest"
cp "$temporary/zklean/libexec/lean4export" "$prefix/libexec/lean4export"
cp -R "$temporary/zklean/libexec/lean/." "$prefix/libexec/lean/"
cp "$temporary/zklean/share/zklean/verifier.json" "$prefix/share/zklean/verifier.json"
chmod +x "$prefix/bin/zklean" "$prefix/libexec/zklean-native" "$prefix/libexec/lean4export"

echo "Installed ZKLean in $prefix"
case ":$PATH:" in
  *":$prefix/bin:"*) ;;
  *) echo "Add $prefix/bin to PATH, then run: zklean doctor" ;;
esac
