# Distribute binaries without opening the source repository

Consumers install a release archive from a separate public, binary-only
repository, `ZeframLou/zklean-dist`. Keep the implementation repository private.
The `Package` workflow prepares archives and checksums; it does not publish a
release, create a tag, or change repository visibility.

The public host is a deployment prerequisite. Until a maintainer creates it and
publishes the prepared files, the README's release installation command is not
available. Local installation is fully testable with `ZKLEAN_RELEASE_BASE`.

## Prepare the release

Build on Ubuntu 22.04 x86-64 with the tools in [Development](DEVELOPMENT.md), then
run all required checks before packaging:

```sh
bash scripts/package-release.sh dist
```

The package script explicitly rebuilds the native prover, even when preceding
tests built a verifier-only binary. The archive contains the compiled CLI,
native prover/checker, guest ELF, Lean exporter, and authenticated checker
profile. It needs glibc 2.35 or newer and libgcc; Go, Docker, Rust, and Bun are
not runtime requirements for the CLI. The upstream proving circuit is installed
automatically from its checksum-pinned official archive, separately from the
CLI archive. Lean is installed automatically through Elan.

`dist/install.sh`, `dist/README.md`, `dist/docs/`, `dist/examples/`,
`dist/benchmarks/`, and `dist/SPEC.md` are the public website files. The benchmark
data contains two real certificates, their checker profile, and original example
exports; the docs include the measured results and generation resource reports. Publish those files to the binary repository's `main`
branch and upload `zklean-linux-x64.tar.gz` and its `.sha256` file as release
assets. Keep the source version at `0.1.0`; choose an immutable release tag only
when publication is explicitly authorized. The public host does not need the
implementation, source history, Git credentials, CI logs, or private artifacts.

Before public installation, verify the raw installer URL and asset URLs without
GitHub authentication. Consumers never need to download Actions artifacts or
configure a native verifier.

## Check the actual archive

Run the `clean-install` CI job, or test on a fresh Ubuntu 22.04 system with
curl, CA certificates, tar, gzip, zstd, and libgcc installed:

```sh
ZKLEAN_PREFIX="$HOME/.local" ZKLEAN_RELEASE_BASE="file://$PWD/dist" sh dist/install.sh
export PATH="$HOME/.local/bin:$PATH"
zklean doctor
zklean init --project /tmp/installed-contract
zklean check --project /tmp/installed-contract --module V1 \
  --claims Inventory.reservation_safe --axioms propext
zklean verify --certificate tests/fixtures/identity.certificate.json
```

Use a fresh home and no Lean, compiler, source checkout tools, or previously
installed native verifier. Do not set `ZKLEAN_SKIP_LEAN`. Mount only the archive,
installer, and proof fixture when testing in a clean container. Installation
must find and use its own exporter, guest, and native binary.

`ZKLEAN_REPOSITORY` selects another binary-only GitHub host;
`ZKLEAN_RELEASE_BASE` selects a mirror or local directory. `ZKLEAN_CIRCUIT_URL`
can select a local copy of the official circuit archive; the pinned checksum
still applies. These overrides let maintainers test the exact prepared bytes
without publishing anything.

## npm consumers

The SDK and HTTPV are separate npm packages at `0.1.0`. Run
`bun scripts/check-package.ts` after `bun run compile` to test an actual SDK
tarball installed with npm, including real embedded proof verification without
native tools. HTTPV's corresponding packed-consumer check installs both
tarballs with npm and exercises its public API.

Publishing the npm packages and the binary host is a maintainer action. No
package, release, tag, merge, or visibility change is performed by packaging.
