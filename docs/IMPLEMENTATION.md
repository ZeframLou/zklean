# Implementation and trust boundary

The TypeScript package supplies HTTPV discovery, verification policy, compatibility,
monitoring, and a Bun server adapter. The Rust workspace supplies the shared
Nanoda checker, offline SDK-based compressed STARK verifier and local SP1 CPU
prover/executor. `crates/guest` is built with the SP1 toolchain.

Nanoda is pinned and vendored; see `vendor/nanoda/UPSTREAM.md`. SP1 is pinned to
5.2.4 and used without source modifications. Verification calls its upstream
SDK with a trusted guest key and pinned fingerprint. A deployment builds the
guest and pins its SHA-256 and SP1 key digest.
Certificates cannot select a verifier identity. The production verifier accepts
neither development signatures nor mock SP1 proofs. Proof generation forcibly
enables SP1's production VK checks and uses fixed recursion/core shapes.

The SDK's recursion key map is omitted from its crates.io source package.
`scripts/prepare-sp1.sh` fetches it from the pinned GitHub source release and
checks the exact SHA-256 required by SP1's build script. This is a public
verification-key map, not a secret or a trusted Groth16 setup. Compressed STARK
proving needs no S3 artifacts or proving network.

See README.md for commands and docs/ENCODING.md for the wire profile.
SPEC.md is the normative experimental protocol specification.
