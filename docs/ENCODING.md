# ZKLean v1 encoding

This document defines the exact bytes an implementation must reproduce:
identities, the statement digest, and the proof. Read the
[specification](../SPEC.md) first. Version 1 uses SP1 6.10.0's Groth16 proofs
over the BN254 curve.

## Canonical JSON

Canonical JSON sorts object keys by UTF-8 bytes, has no whitespace, and permits
only integers from 0 to 2^53 − 1 as numbers. Strings escape only `"`, `\` and
characters below U+0020: `\b \f \n \r \t`, and otherwise `\u00xx` in lowercase
hex. No Unicode normalization is applied, and unpaired surrogates are rejected.

`H(tag, v)` is lowercase hex `SHA256(UTF8(tag) || canonicalJSON(v))`, where `\0`
in a tag is a single 0x00 byte.

## Identities

Identities are computed from the declarations Nanoda has checked, in export
order. Every reference outside an inductive block is to an earlier
declaration, or the export is rejected; within a block, cycles are broken by
the block hash.

**Names** of declarations, referenced constants and universe parameters render
as dotted strings, with numeric components in decimal. An export is rejected if
any string component of such a name is empty, contains `.`, or is all digits.

**Built-in constants.** Nanoda evaluates literals, `Nat` arithmetic, `Quot` and
`eagerReduce` natively, recognizing 31 constants by name. An export may contain
them only with the identities of Lean's own definitions at Lean 4.35.0, listed
in `crates/core/src/kernel.json`; a redefined `Nat.gcd` could otherwise prove
`False`. This also fixes literals' meaning: `Nat.succ` chains and
`String.ofList [Char.ofNat …]`.

**Terms.** Each node is hashed as `H("zklean/node/1\0", node)` with every child
replaced by its hash; a term's hash is its root node's. Universe levels are
hashed the same way.

| Node             | Hashed form                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| level            | `{zero:true}`, `{succ:h}`, `{max:[h,h]}`, `{imax:[h,h]}`, `{param:"u"}`        |
| `bvar i`         | `{bvar:i}`, a de Bruijn index: the i-th enclosing binder, innermost first      |
| `sort l`         | `{sort:h}`                                                                     |
| `const`          | `{const:{name, id, us:[h…]}}`, `us` the universe-level arguments               |
| `app`            | `{app:{fn:h, arg:h}}`                                                          |
| `lam`, `forallE` | `{lam\|forallE:{type:h, body:h}}`                                              |
| `letE`           | `{letE:{type:h, value:h, body:h}}`                                             |
| `proj`           | `{proj:{name, id, idx, struct:h}}`                                             |
| literal          | `{natVal:{value:"digits", type:id(Nat)}}`, `{strVal:{value, type:id(String)}}` |

`id` is the referenced constant's identity, or `null` when that constant is a
member of the inductive block being hashed. Binder names, binder annotations
and `letE` nondependency hints are dropped.

**Declarations** are hashed as `H("zklean/declaration/1\0", d)`. `type` and
`value` are term hashes; `levelParams` are the universe parameter names, in
declaration order.

- A theorem, axiom, definition or opaque whose type is a proposition, as Nanoda
  decides, is
  `{prop:{name, levelParams, type}}`. Its value is omitted, so an `axiom`
  stating a theorem's proposition has the theorem's identity. A definition whose
  _value_ is a proposition, such as `def Ok : Prop := …`, keeps its value.
- Otherwise: `{def:{name, levelParams, type, value}}`, `{opaque:{…}}` likewise,
  `{axiom:{name, levelParams, type}}`, and `{quot:{name, levelParams, type}}`.
  Reducibility hints are omitted.
- Every inductive type belongs to a **block**, the types defined together; a
  single type such as `Nat` is a block of one. The block is
  `g = H("zklean/declaration/1\0", {inductive:{levelParams, numParams, types}})`,
  where `types` lists `{name, type, ctors:[{name, type}]}` in block order, with
  constructors in declaration order; order is part of the identity. Each type,
  constructor and recursor, including constructors of propositions, has
  identity
  `H("zklean/declaration/1\0", {member:{group:g, name}})`; recursors are derived
  from the block and not hashed.

Besides what Nanoda rejects, an export is rejected if members of a block list
the block differently, a theorem's type is not a proposition, a term contains a
free variable, or a name refers to a declaration the export does not contain.

## Statement and proof

The guest's public value is 32 bytes:
`SHA256(UTF8("zklean/statement/1\0") || canonicalJSON({format, claims, axioms}))`.
`statementId` is the same digest in hex. `source` is not part of it.

`proof` is `base64:` followed by padded, canonical RFC 4648 base64 of exactly
356 bytes, as returned by `SP1ProofWithPublicValues.bytes()`: a four-byte
selector naming SP1's circuit key, then the exit code, verifier-key root and
proof nonce (32 bytes each), then the 256-byte uncompressed Groth16 proof. A
proof whose selector does not name the circuit key is rejected.

## Keys

A proof verifies when the unmodified `sp1-verifier` 6.10.0 crate accepts
`Groth16Verifier::verify(proof, digest, verifierKey, GROTH16_VK_BYTES)`, with
the 32-byte statement digest as the public values. `GROTH16_VK_BYTES` fixes
SP1's **circuit key**. The **verifier key** is SP1's `vk.bytes32()` encoding of
the guest, a `0x`-prefixed hex string: `verifierKey` in `src/guest.json`.
