# Implementation and trust boundary

The TypeScript package provides certificate decoding, model snapshots, verifier
policy, and the CLI. The Rust workspace supplies the shared Nanoda checker,
upstream Groth16 verifier, and local SP1 CPU prover and executor.
`crates/guest` is built with the SP1 toolchain. Embedded pairing checks run one at a time in a background
Bun worker that reuses its WASM instance and is replaced after a trap or error.
The compiled CLI embeds both the worker entry point and verifier WASM.

Nanoda is pinned and vendored; see `vendor/nanoda/UPSTREAM.md`. SP1 is pinned to
5.2.4 and used without source modifications. Native and WebAssembly verification call its lightweight
`sp1-verifier` crate with a trusted BN254 checker key. A deployment builds the
guest and pins its SHA-256 and SP1 key digest.
The guest build stages a fresh source snapshot at a canonical temporary path:
Cargo includes local package paths in crate identities, so arbitrary checkout
paths otherwise produce different program layouts and verifier keys. Clean builds
from separate checkouts must match before a proof fixture is regenerated.
Certificates cannot select a verifier identity. The production verifier accepts
neither development signatures nor mock SP1 proofs. Proof generation forcibly
enables SP1's production VK checks and uses fixed recursion/core shapes.

The SDK's recursion key map is omitted from its crates.io source package.
`scripts/prepare-sp1.sh` fetches it from the pinned GitHub source release and
checks the exact SHA-256 required by SP1's build script. This is a public
verification-key map. The CLI installer and `scripts/setup-circuits.sh` download
checksum-pinned SP1 production circuit artifacts; verification uses the circuit key embedded in
the upstream crate and downloads nothing. The native gnark backend is linked
into the prover, so recipients and CLI users do not need Go or Docker.

See README.md for commands and docs/ENCODING.md for the wire profile.
SPEC.md is the normative experimental protocol specification.

Prepared release archives contain a compiled Bun CLI, native verifier/prover, guest ELF,
verifier profile, and lean4export in one checksum-pinned archive. `install.sh`
installs that archive and automatically installs the pinned Lean toolchain through
`elan`. Tool discovery is relative to the CLI or `ELAN_HOME`, so ordinary commands
require no environment variables or configuration files.

Authenticated imports construct kernel nodes as private top-level data definitions
to avoid elaboration depth growing with the number of nodes. Lean string literals
use a dedicated encoder, and reused declarations are compared after the pinned
exporter's metadata erasure and nondependent-let hint normalization. These hints
do not change kernel meaning.
