# ZKLean v1 encoding profile

This profile uses **SP1 5.2.4 Groth16 over BN254**. Identities are computed from
the environment Nanoda has checked, so the checker and the identities read the
export through one parser. Verification is offline and needs no proving
artifacts, Lean process or native executable.

## Canonical JSON

Canonical JSON sorts object keys by UTF-8 bytes, has no whitespace, uses JSON
string escaping, and permits only nonnegative safe integers as numbers. No
Unicode normalization is applied, and unpaired surrogates are rejected. `H(tag, v)`
is lowercase hex `SHA256(UTF8(tag) || canonicalJSON(v))`.

## Identities

An identity hashes one declaration's meaning together with its whole dependency
closure. Each reference to another constant carries that constant's identity, so
equal identities mean equal names, statements and definitions throughout.

**Names** are rendered as dotted strings. Ambiguous components (empty, containing
`.`, or all digits) are rejected.

**Nodes** are hashed Merkle-style as `H("zklean/node/1\0", node)`, with every
child replaced by its hash:

| Node | Hashed form |
| --- | --- |
| level | `{zero:true}`, `{succ:h}`, `{max:[h,h]}`, `{imax:[h,h]}`, `{param:"u"}` |
| `bvar i` | `{bvar:i}` |
| `sort l` | `{sort:h}` |
| `const` | `{const:{name, id, us:[h…]}}` |
| `app` | `{app:{fn:h, arg:h}}` |
| `lam`, `forallE` | `{lam\|forallE:{type:h, body:h}}` |
| `letE` | `{letE:{type:h, value:h, body:h}}` |
| `proj` | `{proj:{name, id, idx, struct:h}}` |
| literal | `{natVal:{value:"digits", type:id(Nat)}}`, `{strVal:{value, type:id(String)}}` |

Binder names, binder annotations and `letE` nondependency hints are dropped:
they do not affect meaning. `id` is the referenced constant's identity, or `null`
for a reference inside the inductive group being hashed. Universe parameter names
are kept, so renaming one changes the identity.

**Declarations** are hashed as `H("zklean/declaration/1\0", d)`:

- A declaration whose type is a proposition, as decided by the checker, is a
  proof: a theorem, or an axiom, definition or opaque of a proposition. It is
  `{prop:{name, levelParams, type}}`. Proofs are irrelevant, so its value is
  omitted, and an `axiom` stating a theorem's proposition has the theorem's
  identity. A definition whose *value* is a proposition, such as
  `def Ok : Prop := …`, is not a proof and keeps its value.
- Otherwise a definition is `{def:{name, levelParams, type, value}}`, an opaque
  `{opaque:{…}}` likewise, an axiom `{axiom:{name, levelParams, type}}` and a
  quotient primitive `{quot:{name, levelParams, type}}`. Reducibility hints do
  not affect meaning and are omitted; Nanoda rejects unsafe and partial
  declarations.
- A mutual inductive block is hashed once, as the kernel's input for it:
  `g = H("zklean/declaration/1\0", {inductive:{levelParams, numParams, types}})`,
  where `types` lists each type's `{name, type, ctors:[{name, type}]}` in block
  order. Order is part of the identity, because it fixes the order of the
  recursors' motives; declaring a mutual block in another order changes it. Recursors are derived from this input and checked by Nanoda, so they
  are not hashed. Each type, constructor and recursor of the block has identity
  `H("zklean/declaration/1\0", {member:{group:g, name}})`.

`levelParams` are universe parameter names, so renaming one changes the identity.
The kernel admits no cycles between declarations except within an inductive
block, so every identity is well defined.

## Statement and certificate

The guest commits exactly 32 bytes, the statement digest:

```text
statementId = H("zklean/statement/1\0", {format, claims, axioms})
```

`claims` and `axioms` each map Lean names to identities. A name occurs in at most
one of them. The certificate's `source` is not
committed; it only locates an export that must reproduce these identities.

The certificate's `proof` is `base64:` followed by padded, canonical RFC 4648
base64 of exactly 260 bytes: SP1's four-byte circuit-key selector and the 256-byte
uncompressed Groth16 proof, as returned by `SP1ProofWithPublicValues.bytes()`.
Other SP1 modes and lengths are rejected.

## Verifier keys

Verification calls the unmodified upstream `sp1-verifier` crate, compiled to
WebAssembly. Its circuit key is fixed by version 5.2.4. The checker key is SP1's
BN254 `vk.bytes32()` encoding of the pinned guest, in `src/guest.json`
with the guest ELF's SHA-256; `zklean pin` derives both from a built guest.
Applications can choose a different trusted key with `groth16Backend(key)`;
certificate data cannot select one. Groth16 soundness relies on SP1's trusted
setup; a new theorem needs no new ceremony. The profile establishes
derivability and integrity; it makes no claim of witness privacy beyond
upstream SP1's guarantees.
