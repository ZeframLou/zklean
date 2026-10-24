# ZKLean v1 encoding profile

This profile uses **SP1 5.2.4 Groth16 over BN254**. The local CPU prover uses
SP1's published circuit artifacts and native gnark backend. Verification is
offline and requires no proving artifacts, Lean process, or native executable.

## Canonical public model

`specs.declarations` is `base64:` followed by padded RFC 4648 base64 of UTF-8
canonical JSON. Its decoded schema is:

```json
{
  "format": "lean4/kernel/2",
  "declarations": { "Namespace.claim": { "thm": { "name": "<hash>", "levelParams": [], "type": "<hash>" } } },
  "nodes": { "<sha256>": { "sort": "<level-hash>" } }
}
```

The example is schematic; actual models include every referenced node and
constant. The schema serializes Lean's existing kernel expressions, names,
levels, and declarations, using lean4export 3.1.0 field names. Every `in`, `il`,
and `ie` reference is replaced by a lowercase SHA-256 identity of the referenced
node's canonical JSON. The index fields are removed. Name zero is
`{"anonymous":true}` and level zero is `{"zero":true}`. Nodes share a single
content-addressed table; their variant tags identify their kernel types.

The guest verifies the entire private export with Nanoda before projection.
Public roots are the requested propositions and **all actually used axioms**.
The projection follows types, definition bodies, inductive groups, constructors,
recursors, and implicit Nat/String literal dependencies. Theorems and other
proposition-valued definition/opaque bodies become `thm` declarations containing
only `name`, `levelParams`, and `type`. Their proof bodies and nodes reachable
only from those bodies are excluded. Actual axioms retain `axiom` declarations.
Axioms used only by private proof terms still have public declarations and types.
Mutual inductive groups are indivisible. The lexicographically first member stores
the group once; other declared names use an `inductiveMember` reference to it.

Deserialization resolves Name/Level/Expr hashes in `nodes`, then constant name
hashes against `declarations`. `readModel` checks hashes, typed references,
closure, and absence of unrelated nodes. A compatibility elaborator may admit
certified propositions as axioms **only after independently verifying their
certificate and exact resolved context**. The supplied bridge workflow uses
Lean's own elaborator and exporter, followed by Nanoda in SP1.

Canonical JSON sorts keys by UTF-8 bytes, has no whitespace, uses JSON string
escaping, and permits only nonnegative safe integers as numeric data. No
Unicode normalization is applied. Unpaired Unicode surrogates are rejected.
Claims and axioms are unique names sorted by UTF-8 bytes. Base64 is canonical
and padded, including zero unused padding bits. Metadata and original export
indices do not affect model identities. Ambiguous dotted name components and
numeric string name components are rejected rather than conflated with Lean's
numeric name constructor. Export metadata records format 3.1.0; checker semantics
and enabled Nat/String kernel extensions are fixed by the pinned guest ELF.

## Authenticated public values

The guest commits exactly 32 bytes:

```text
SHA256(UTF8("zklean/statement/1\0") || canonicalJSON({format,specs,axioms}))
```

The certificate's `proof` is `base64:` followed by padded RFC 4648 base64 of
exactly 260 bytes: SP1's four-byte circuit-key selector and 256-byte uncompressed
Groth16 proof, as returned by `SP1ProofWithPublicValues.bytes()`. Other SP1 modes
and proof lengths are rejected. The public specification is transmitted in
addition to these proof bytes.

Both native and WebAssembly verification call the unmodified upstream
`sp1-verifier` crate. Its circuit key is fixed by version 5.2.4; the checker key
is SP1's BN254 `vk.bytes32()` encoding, **not** a serialized BabyBear digest.
The npm package includes the WebAssembly verifier and the trusted checker key
in `src/guest.json`. Applications can choose a different trusted checker through
`groth16Backend(key)`; certificate data cannot supply this configuration.

A prover additionally pins `elfSha256` and the ELF path. `zklean pin` derives the
key and digest from the built guest. Verification needs neither the ELF nor its
serialized SP1 key. SP1's production recursion VK checks remain enabled during
proving; no mock or development circuit is accepted. Groth16 soundness relies
on SP1's trusted setup; a new theorem does not require a new setup ceremony.

Every permitted axiom must match its reviewed declaration and complete dependency
context. The standard fingerprints are generated from the pinned Lean toolchain;
custom fingerprints are supplied by the recipient. Bound-variable display names
and binder annotations are ignored for context matching, while constant names,
definition bodies, and types remain bound. A name-only allowlist is insufficient.
This profile establishes derivability and integrity; it makes no claim about
witness privacy beyond upstream SP1's guarantees.

Certificate identity is
`SHA256("zklean/certificate/1\0" || canonicalJSON(certificate))`.
Model identity is `SHA256("zklean/model/1\0" || canonicalJSON(specs))`.
Neither identity depends on arbitrary input JSON property order.

## Requirement snapshots

Local requirements use `{format:"zklean/requirements/1",specs}`. A `.lean` path
resolves to `<path>.zklean.json` and requires a `zklean/source-manifest/1`
containing the primary source, imported sources, Lake project files, and toolchain
artifacts. Every recorded digest is checked before the sidecar is used.
The self-contained snapshot is what the application trusts.

[HTTPV](https://github.com/ZeframLou/httpv) defines discovery and compatibility
checking separately from this certificate profile.
