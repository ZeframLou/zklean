# Implementation and trust boundary

The TypeScript package supplies HTTPV discovery, verification policy, compatibility,
monitoring, and a Bun server adapter. The Rust workspace supplies the shared
Nanoda checker and SP1 host; `crates/guest` is built with the SP1 toolchain.

Nanoda is pinned and vendored; see `vendor/nanoda/UPSTREAM.md`. SP1 is pinned to
5.2.4. A deployment must build the guest and pin its SHA-256 and SP1 verification
key. Certificates cannot select a verifier identity. No development signature or
mock proof is accepted by the production verifier.

See README.md for build, verification, and example commands. SPEC.md remains the
normative experimental protocol specification. Encoding details are documented
in docs/ENCODING.md.
