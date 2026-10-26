# ZKLean certificate specification

This specification is for implementers of ZKLean verifiers and provers. It
defines what a certificate states, its format, and how it is verified;
[ENCODING.md](docs/ENCODING.md) defines the exact bytes. The key words MUST,
MUST NOT, SHOULD and MAY follow RFC 2119 and RFC 8174.

## 1. Model

A certificate proves that Lean theorems, its **claims**, follow from the
**axioms** it lists. Each claim and axiom is named by an **identity**: a hash of
the declaration (definition, theorem or axiom) and everything it depends on, so
equal identities denote the same statement about the same definitions.

```text
Lean module ── lean4export ──> export ── Nanoda inside SP1 ──> certificate
```

The **export** is the module's declarations as written by
[lean4export](https://github.com/leanprover/lean4export). The **guest**, a
program that [SP1](https://github.com/succinctlabs/sp1) runs and proves, checks
the export with [Nanoda](https://github.com/ammkrn/nanoda_lib), a Lean type
checker written independently of Lean, and outputs the **statement digest** of
`{format, claims, axioms}`. The resulting Groth16 proof is valid only for the
guest identified by a **verifier key**.

Verification establishes properties of a Lean model, not of deployed code, and
only the certificate's own claims. A verifier:

- MUST pin a trusted verifier key, and MUST NOT accept one from a certificate;
- MUST permit each axiom by name and identity; and
- MUST compare each claim it relies on by name and identity, since a name alone
  carries no meaning.

## 2. Generation

The guest reads one input, `{export, claims}`: the export as a string and the
claim names. It MUST:

- check the entire export with Nanoda;
- reject an export that redefines any of the 31 constants Nanoda evaluates
  natively by name, such as `Nat.gcd`;
- require every claim to be a theorem whose type is a proposition;
- collect every axiom the claims' proofs use; and
- output the statement digest of the claims and those axioms.

## 3. Certificate

```json
{
  "format": "zklean/1",
  "claims": { "Inventory.reservation_safe": "65de…8b2f" },
  "axioms": { "propext": "a6bb…4158" },
  "proof": "base64:…",
  "source": "https://acme.example/reservation.ndjson"
}
```

| Field    | Content                                                                |
| -------- | ---------------------------------------------------------------------- |
| `format` | `"zklean/1"`                                                           |
| `claims` | at least one claim, name to identity                                   |
| `axioms` | every axiom the proofs use, name to identity; no name also in `claims` |
| `proof`  | the encoded proof of the statement digest                              |
| `source` | `https` URL, without credentials, of an export behind the identities   |

A certificate is **well formed** when it has exactly these fields with these
contents, every name is non-empty, every identity is 64 lowercase hexadecimal
characters, and the proof is canonical base64 of exactly 356 bytes. Verifiers
MUST reject any other certificate.

Lean's **standard axioms** are `propext`, `Quot.sound` and `Classical.choice`
with their Lean 4.35.0 identities, listed in `src/axioms.json`. An axiom is
standard only if both name and identity match.

## 4. Verification

A verifier's **axiom policy** is the axioms it permits, by name and identity.
Verification succeeds only when the certificate is well formed, every entry of
`axioms` is in the policy with the same identity, and the proof verifies
against the pinned verifier key and the statement digest.

A certificate stays valid for as long as verifiers pin the same verifier key;
a new checker has a new key and needs new certificates.

## 5. Source

The source is not part of the proved statement. A verifier that uses it first
verifies the certificate, then checks the export with Nanoda and accepts it
only if it reproduces the identity of every claim and every non-standard axiom;
the export MUST contain all of them and everything they depend on. Anyone
fetching the source MUST NOT follow redirects. A wrong source can only fail
this check, and the author can move the file without re-proving.

## 6. Requirements

A requirement records the claims a verifier's own proofs assume:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Inventory.reservation_safe": "…" }
}
```

It is well formed when it has exactly these two fields, `format` is
`"zklean/requirements/1"`, `claims` has at least one entry, every name is
non-empty, and every identity is 64 lowercase hexadecimal characters; verifiers
MUST reject any other. Each claim MUST be a proposition, proved or stated as an
axiom. A certificate satisfies a requirement when every required claim appears
in its `claims` with the same identity; an entry of `axioms` never does.

## 7. References

[Lean 4](https://github.com/leanprover/lean4) ·
[lean4export](https://github.com/leanprover/lean4export) ·
[Nanoda](https://github.com/ammkrn/nanoda_lib) ·
[SP1](https://github.com/succinctlabs/sp1) ·
[encoding](docs/ENCODING.md) · [usage guide](docs/USAGE.md)
