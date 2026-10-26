# ZKLean certificate specification

## 1. Purpose

This specification is for people implementing a ZKLean verifier or prover. It
defines what a certificate states, its format, and how it is verified. The
[README](README.md#concepts) introduces the concepts.

ZKLean certifies that Lean propositions have been proved. A certificate names
each certified proposition, and each axiom its proof uses, by an **identity**:
a hash of the declaration and everything it depends on. It carries a 356-byte
**Groth16 proof**, a succinct cryptographic proof produced by SP1, that a
specific checker program accepted the proofs. That program is identified by
its **verifier key**, which verifiers pin. The certificate also gives the URL of
one Lean **export**, a file of declarations written by lean4export, that holds
the definitions behind every identity. Recipients verify the proof without the
proofs themselves or a Lean installation. A certificate is under 1 KB for a few
claims; it grows with the number of claims, not with the size of the proofs.

ZKLean is usable independently of HTTP. The separate
[HTTPV protocol](https://github.com/ZeframLou/httpv) serves certificates for
API endpoints and checks them against client requirements.

## 2. Conventions and security model

The terms MUST, MUST NOT, SHOULD, and MAY follow RFC 2119 and RFC 8174.

Verification depends on the soundness of the trusted checker and the
cryptographic proving system. Clients MUST pin a trusted verifier key and permit
each axiom by name and identity. Equal identities denote the same statement about
the same definitions. Certificates establish properties of a mathematical model;
they do not attest to deployed code.

## 3. Certificates

### 3.1. Architecture

```text
Lean module ── lean4export ──> export ── Nanoda in SP1 ──> identities + Groth16 proof
```

- **lean4export** writes the declarations Lean has checked, one JSON object per
  line (NDJSON).
- **Nanoda** independently checks those declarations.
- **SP1** proves that the checker accepted them and computed the committed identities.

### 3.2. Certificate generation

The **guest**, the program SP1 runs and proves, MUST:

- check the entire export with Nanoda;
- reject an export that redefines any of the 31 constants Nanoda evaluates
  natively by name, such as `Nat.gcd` (see [ENCODING.md](docs/ENCODING.md));
- require every claim to be a theorem whose type is a proposition;
- collect every axiom the claims' proofs use; and
- commit the identities of the claims and those axioms.

### 3.3. Certificate format

```json
{
  "format": "zklean/1",
  "claims": { "Inventory.reservation_safe": "65de…8b2f" },
  "axioms": { "propext": "a6bb…4158" },
  "proof": "base64:…",
  "source": "https://acme.example/reservation.ndjson"
}
```

- `claims`: the certified propositions, by Lean name and identity.
- `axioms`: every axiom the proofs use, by name and identity. A name occurs in at
  most one of `claims` and `axioms`.
- `proof`: the Groth16 proof of `{format, claims, axioms}`.
- `source`: the `https` URL, without credentials, of one lean4export file that
  contains every claim and every axiom other than Lean's standard ones, with
  everything they depend on. Clients MUST NOT follow redirects from
  it, so the URL is the file's final address.

The source is not part of the proved statement. It is an untrusted pointer: a
recipient verifies the certificate, then checks the file with Nanoda and accepts
it only if it reproduces the identity of every claim and non-standard axiom. A source matched against an
unverified certificate means nothing, since a forger can choose identities that
match any file. A wrong source can make that check fail, but cannot make a
different statement match. Because `source` is outside the proof, the author can
move the file and change the URL without re-proving.

`zklean prove` writes the export it proved from next to the certificate, ready
to publish. That export contains the proofs. A provider who keeps its proofs
private instead publishes the export of a module that states its claims as
`axiom`s; the identities are the same.

[ENCODING.md](docs/ENCODING.md) defines identities, the committed statement and
the proof encoding.

### 3.4. Verification

Verification succeeds only when the certificate is well formed, every `axioms`
entry equals an entry of the client's policy by name and identity, and the
Groth16 proof verifies against the pinned verifier key and the **statement
digest**, the hash of `{format, claims, axioms}` defined in
[ENCODING.md](docs/ENCODING.md).
A verifier MUST NOT accept a verifier key from the certificate.

Certificates MAY be generated offline, and stay valid for as long as verifiers
pin the same verifier key. A new checker version has a new key, so its
verifiers need new certificates.

## 4. Requirements

A requirement lists the propositions a recipient's own proofs assume:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Inventory.reservation_safe": "…" }
}
```

`zklean requirements` computes it from local Lean code. Each claim must be a
proposition, proved or stated as an axiom. A certificate satisfies a requirement
when every required claim appears among its `claims` with the same identity; an
entry of `axioms` never satisfies a requirement.

## 5. References

- [Lean 4](https://github.com/leanprover/lean4)
- [lean4export](https://github.com/leanprover/lean4export)
- [Nanoda](https://github.com/ammkrn/nanoda_lib)
- [SP1](https://github.com/succinctlabs/sp1)
- [Encoding profile](docs/ENCODING.md)
- [Usage guide](docs/USAGE.md), for the command-line interface
