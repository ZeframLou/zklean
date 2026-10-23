# ZKLean v1 encoding profile

This implementation uses **SP1 5.2.4 compressed STARK proofs**. The experimental
specification's initial profile was updated from Groth16 at the user's request.
Proofs are generated locally with the CPU prover. No remote proving service,
trusted Groth16 setup, S3 circuit download, or Docker container is needed.

## Canonical public model

`specs.declarations` is `base64:` followed by padded RFC 4648 base64 of UTF-8
canonical JSON. Its decoded schema is:

```json
{
  "format": "lean4/kernel/1",
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
Mutual inductive groups are indivisible and shared by their declared names.

Deserialization resolves Name/Level/Expr hashes in `nodes`, then constant name
hashes against `declarations`. `readModel` checks hashes, typed references,
closure, and absence of unrelated nodes. A compatibility elaborator may admit
certified propositions as axioms **only after independently verifying their
certificate and exact resolved context**. The supplied bridge workflow uses
Lean's own elaborator and exporter, followed by Nanoda in SP1.

Canonical JSON sorts keys by UTF-8 bytes, has no whitespace, uses JSON string
escaping, and permits only nonnegative safe integers as numeric data. No
Unicode normalization is applied. Claims and axioms are unique names sorted by
UTF-8 bytes. Base64 is canonical and padded. Metadata and original export
indices do not affect model identities. Ambiguous dotted name components and
numeric string name components are rejected rather than conflated with Lean's
numeric name constructor. Export metadata records format 3.1.0; checker semantics
and enabled Nat/String kernel extensions are fixed by the pinned guest ELF.

## Authenticated public values

The guest commits exactly 32 bytes:

```text
SHA256(UTF8("zklean/statement/1\0") || canonicalJSON({format,specs,axioms}))
```

The certificate's `proof` is `base64:` encoding of the SP1 5.2.4 `SP1Proof::Compressed`
variant, serialized with bincode 1.3 fixed-width little-endian encoding. Trailing
bytes and over-limit decoding are rejected. The verifier accepts only compressed
proofs under SP1's pinned production recursion key root and permitted key set.
Mock/development keys are not accepted. The proof authenticates the guest key
and the statement commitment; the certificate cannot choose either verifier.

Trusted local verifier configuration pins `verifierKey`. A prover additionally
pins `elfSha256` and the ELF path; verifiers may enforce these optional file pins
but do not need the ELF to verify certificates. `verifierKey` is
`0x` followed by hex of `bincode::serialize(&vk.hash_babybear())`: eight BabyBear
field elements, 32 bytes total. It is **not** SP1's BN254 `vk.bytes32()` encoding.
`zklean pin` derives these values from the locally built guest. Distribute the
configuration through the client's trusted release process, never discovery.

SP1's standalone compressed verifier requires at least two execution shards.
The prover chooses small shards and rejects any proof its standalone verifier
cannot validate. Compressed proofs are larger and more expensive to verify than
Groth16; they avoid Groth16's setup and circuit artifacts. This profile proves
derivability and integrity; it does not promise zero knowledge of the witness.

Certificate identity is
`SHA256("zklean/certificate/1\0" || canonicalJSON(certificate))`.
Model identity is `SHA256("zklean/model/1\0" || canonicalJSON(specs))`.
Neither identity depends on arbitrary input JSON property order.

## Requirements and compatibility

Requirements are local JSON `{format:"httpv/requirements/1",specs}` snapshots.
A `.lean` path resolves to `<path>.httpv.json` and requires `sourceSha256` matching
that source file. Regenerate snapshots whenever imported sources or toolchains
change; the direct-source digest alone cannot detect edits to imported files.
The self-contained snapshot is what the client actually trusts.

Exact matching requires every requested claim to be certified and its complete
resolved public context to match. Extra remote claims are permitted. Under
`mode:"exact"`, a mismatch is `incompatible` with that explicit exact contract.
The default implication mode returns `unknown` when no derivation is available.

A bridge certificate proves the required propositions, admitting certified remote
claims as axioms. Its actual axioms must be client-permitted axioms or verified
remote claims. The checker compares requirement contexts, the types of assumed
remote propositions, and every shared definition; reinterpreting a constant name
invalidates the bridge. Extra remote claims need not appear in a bridge.
An implication is accepted only after independently verifying both certificates.

HTTPS authenticates the currently advertised resource/method association. The
library uses exact URL paths and requires explicit development opt-in for HTTP.
Formal authors must specify the operation, input domain, and resource association;
the transport cannot infer their meaning from a theorem's name.
