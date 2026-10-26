# ZKLean v1 encoding

This document defines the exact bytes an independent implementation must
reproduce: identities, the committed statement, and the proof encoding. Read
the [specification](../SPEC.md) first.

Version 1 uses SP1 6.10.0's Groth16 proofs, over the BN254 elliptic curve.
Identities are computed from the declarations after Nanoda, the Lean type
checker the guest runs, has checked them, so the checker and the identities
read the export through one parser. Verification is offline and needs no
proving files, Lean process or native executable.

Lean terms are built from a few kinds of node, such as function application
and `fun` abstraction, and every term has a **universe level** (a `Sort`),
itself a small expression over universe parameters. The tables below hash both.

## Canonical JSON

Canonical JSON sorts object keys by UTF-8 bytes, has no whitespace, and permits
only integers from 0 to 2^53 − 1 as numbers. Strings escape only `"`, `\` and
characters below U+0020: `\b \f \n \r \t`, and otherwise `\u00xx` in
lowercase hex. No Unicode normalization is applied, and unpaired surrogates are
rejected. `H(tag, v)` is lowercase hex `SHA256(UTF8(tag) || canonicalJSON(v))`.

## Identities

An identity hashes one declaration's meaning together with everything it
depends on, directly or indirectly. Each reference to another constant carries
that constant's identity, so equal identities mean equal names, statements and
definitions throughout.

**Names** of declarations, of referenced constants and of universe parameters
are rendered as dotted strings; numeric components render in decimal. An
export is rejected if a string component of any such name is ambiguous: empty,
containing `.`, or all digits. Binder names are never rendered.

**Built-in constants.** For speed, the checker evaluates natural-number and
string literals, `Nat` arithmetic, quotients (`Quot`) and the `eagerReduce`
evaluation hint natively, recognizing them by name. An export may contain these
31 constants only with the identities of Lean's own definitions at the pinned
toolchain, listed in `crates/core/src/kernel.json`; otherwise it is rejected,
since a redefined `Nat.gcd`, for example, would prove `False`. This also fixes
the meaning of literals, which stand for `Nat.succ` chains and
`String.ofList [Char.ofNat …]`.

**Nodes** of each term are hashed as `H("zklean/node/1\0", node)`, with every
child replaced by its hash, as in a Merkle tree. A term's hash is the hash of
its root node.

| Node             | Hashed form                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| level            | `{zero:true}`, `{succ:h}`, `{max:[h,h]}`, `{imax:[h,h]}`, `{param:"u"}`        |
| `bvar i`         | `{bvar:i}`                                                                     |
| `sort l`         | `{sort:h}`                                                                     |
| `const`          | `{const:{name, id, us:[h…]}}`                                                  |
| `app`            | `{app:{fn:h, arg:h}}`                                                          |
| `lam`, `forallE` | `{lam\|forallE:{type:h, body:h}}`                                              |
| `letE`           | `{letE:{type:h, value:h, body:h}}`                                             |
| `proj`           | `{proj:{name, id, idx, struct:h}}`                                             |
| literal          | `{natVal:{value:"digits", type:id(Nat)}}`, `{strVal:{value, type:id(String)}}` |

Binder names, binder annotations and `letE` nondependency hints are dropped:
they do not affect meaning. `id` is the referenced constant's identity, or `null`
for a reference to a member of the inductive block being hashed (see below).
`us` lists the hashes of the constant's universe-level arguments.

**Declarations** are hashed as `H("zklean/declaration/1\0", d)`. In every
form, `type` and `value` are term hashes, and `levelParams` lists the
declaration's universe parameter names, so renaming one changes the identity.

- A theorem, axiom, definition or opaque whose type is a proposition, as
  decided by the checker, is a proof. It is `{prop:{name, levelParams, type}}`.
  Proofs are irrelevant, so its value is omitted, and an `axiom` stating a
  theorem's proposition has the theorem's identity. A definition whose _value_
  is a proposition, such as `def Ok : Prop := …`, is not a proof and keeps its
  value.
- Otherwise a definition is `{def:{name, levelParams, type, value}}`, an opaque
  `{opaque:{…}}` likewise, an axiom `{axiom:{name, levelParams, type}}` and a
  quotient primitive `{quot:{name, levelParams, type}}`. Reducibility hints do
  not affect meaning and are omitted; Nanoda rejects unsafe and partial
  declarations.
- Every inductive type belongs to a **block**: a group of inductive types
  defined together, or a single inductive type, such as `Nat`, as a block of
  one. A block is hashed once, as the description Lean's checker receives for
  it:
  `g = H("zklean/declaration/1\0", {inductive:{levelParams, numParams, types}})`,
  where `types` lists each type's `{name, type, ctors:[{name, type}]}`, types in
  block order and constructors in declaration order. Order is part of the
  identity, because it fixes the order of the recursors' motives; declaring a
  mutual block in another order changes it. Recursors are derived from this
  input and checked by Nanoda, so they are not hashed. Each type, constructor
  and recursor of the block, including constructors of propositions, has
  identity `H("zklean/declaration/1\0", {member:{group:g, name}})`.

Nanoda checks each declaration against only those before it, so an export lists
declarations in dependency order. Identities are computed in that order, and the
only cycles, within an inductive block, are broken by the block hash.

## Statement and certificate

The guest's **public value**, the output the proof commits to, is exactly 32
bytes: the SHA-256 digest of the statement,

```text
SHA256(UTF8("zklean/statement/1\0") || canonicalJSON({format, claims, axioms}))
```

`statementId` is that digest in lowercase hex, `H("zklean/statement/1\0", …)`.
`claims` and `axioms` each map Lean names to identities. A name occurs in at
most one of them. The certificate's `source` is not part of the digest; it only
locates an export that must reproduce these identities.

The certificate's `proof` is `base64:` followed by padded, canonical RFC 4648
base64 of exactly 356 bytes: a four-byte selector naming SP1's circuit key (see
[Verifier keys](#verifier-keys)), the exit code, verifier-key root and proof
nonce (32 bytes each), and the 256-byte uncompressed Groth16 proof, as returned
by `SP1ProofWithPublicValues.bytes()`. Other SP1 modes and lengths are rejected.

## Verifier keys

Verification calls the unmodified upstream `sp1-verifier` crate, compiled to
WebAssembly. Two keys are involved:

- SP1's **circuit key** identifies its Groth16 circuit. `sp1-verifier` 6.10.0
  fixes it, and the proof's four-byte selector names it.
- The **verifier key** identifies the guest program the proof is about. It is
  SP1's `vk.bytes32()` encoding of the pinned guest, stored in `src/guest.json`
  with the SHA-256 of the guest's compiled program (its ELF file). `zklean pin`
  derives both from a built guest.

Applications can choose a different trusted verifier key with
`groth16Backend(key)`; certificate data cannot select one.

## Security assumptions

Groth16 soundness relies on SP1's **trusted setup**, a one-time ceremony that
generated the circuit key; if every participant colluded, they could forge
proofs. A new theorem needs no new setup. Version 1 establishes that the claims were proved and that the
certificate is intact. It makes no promise that the proof reveals nothing about
the Lean proofs beyond what upstream SP1 guarantees.
