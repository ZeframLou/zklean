# ZKLean v1 encoding profile

This profile uses **SP1 5.2.4 Groth16 over BN254**. Verification is offline and
needs no proving artifacts, Lean process or native executable.

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
| `const` | `{const:{name, us:[h…], id}}` |
| `app` | `{app:{fn:h, arg:h}}` |
| `lam`, `forallE` | `{lam\|forallE:{type:h, body:h}}` |
| `letE` | `{letE:{type:h, value:h, body:h}}` |
| `proj` | `{proj:{typeName, idx, struct:h, id}}` |
| literal | `{natVal:{value:"digits", type:id(Nat)}}`, `{strVal:{value, type:id(String)}}` |

Binder names, binder annotations and `letE` nondependency hints are dropped:
they do not affect meaning. `id` is the referenced constant's identity, or `null`
for a reference inside the inductive group being hashed. Universe parameter names
are kept, so renaming one changes the identity.

**Declarations** are hashed as `H("zklean/declaration/1\0", d)`:

- A declaration whose type is a proposition, as decided by the checker (theorems,
  and axioms, definitions or opaques that are proofs), is
  `{prop:{name, levelParams, type:h}}`. Proofs are irrelevant, so its body is
  omitted, and an `axiom` stating a theorem's proposition has the theorem's identity.
  A definition whose *value* is a proposition, such as `def Ok : Prop := …`, is not
  a proof and keeps its body.
- Other declarations are `{def|opaque|axiom|quot: fields}`. The fields are the
  lean4export 3.1.0 fields, with names as strings and expressions as node hashes,
  minus `all` and the quotient `kind`.
- A mutual inductive group (types, constructors and recursors) is hashed once as
  `g = H("zklean/declaration/1\0", {inductive:{types, ctors, recs}})`, minus
  `all` and `isReflexive`. Each member's identity is
  `H("zklean/declaration/1\0", {member:{group:g, name}})`.

The kernel admits no cycles between declarations except within an inductive
group, so every identity is well defined.

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

Native and WebAssembly verification both call the unmodified upstream
`sp1-verifier` crate. Its circuit key is fixed by version 5.2.4. The checker key
is SP1's BN254 `vk.bytes32()` encoding of the pinned guest, shipped in
`src/guest.json`. Applications can choose a different trusted key with
`groth16Backend(key)`; certificate data cannot select one. A prover additionally
pins the guest ELF's SHA-256, and `zklean pin` derives both values from a built
guest. Groth16 soundness relies on SP1's trusted setup; a new theorem needs no
new ceremony. The profile establishes derivability and integrity; it makes no
claim of witness privacy beyond upstream SP1's guarantees.
