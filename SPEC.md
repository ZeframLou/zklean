# ZKLean

**Certificate specification**

## 1. Purpose

ZKLean certifies that Lean propositions have valid derivations under explicitly
declared axioms. A certificate names each certified proposition by a content
**identity**, a hash of its statement and everything the statement depends on,
and carries a 260-byte Groth16 proof that a pinned checker accepted the
derivation. Recipients verify it without the proof terms, the definitions, or a
Lean installation. A certificate is a few hundred bytes whatever the size of
the proofs.

ZKLean is usable independently of HTTP. The separate
[HTTPV protocol](https://github.com/ZeframLou/httpv) discovers API certificates
and checks their compatibility with client requirements.

## 2. Conventions and security model

The terms MUST, MUST NOT, SHOULD, and MAY follow RFC 2119 and RFC 8174.

Verification depends on the soundness of the trusted checker and the
cryptographic proving system. Clients MUST pin a trusted verifier key and permit
each axiom by name and identity. An identity fixes a proposition's meaning: equal
identities denote the same statement about the same definitions. Certificates
establish properties of the mathematical model; they do not attest to deployed
code.

## 3. Certificates

### 3.1. Architecture

```text
Lean specifications + proofs
            |
       lean4export
            |
   Nanoda inside SP1: check, then compute identities
            |
   Certificate: identities + Groth16 proof
```

- **lean4export** exports Lean 4 declarations and their dependencies.
- **Nanoda** independently checks the exported kernel terms.
- **SP1** proves that the checker accepted them and computed the committed identities.

### 3.2. Certificate generation

The SP1 guest MUST:

1. Check the entire exported environment with Nanoda.
2. Require every claim to be a theorem whose type is a proposition.
3. Collect every axiom the claims' proofs use, and reject axioms the prover did
   not permit.
4. Require every listed definition to occur in the claims' statements, through
   types and definition bodies only, and not to be a proof.
5. Reject a name that occurs in more than one of claims, definitions and axioms.
6. Commit the identities of the claims, definitions and axioms.

### 3.3. Certificate format

```json
{
  "format": "zklean/1",
  "claims": { "Inventory.reservation_safe": "b682…698a" },
  "definitions": { "Inventory.POST_reservations": "93a7…315d" },
  "axioms": { "propext": "dba3…d434" },
  "proof": "base64:…",
  "source": "https://acme.example/reservation.ndjson"
}
```

- `claims`: certified propositions, by Lean name and identity.
- `definitions`: non-proof declarations the claims state facts about, such as
  an API operation. It MAY be empty.
- `axioms`: every axiom the proofs use.
- `proof`: the Groth16 proof of the statement.
- `source`: the `https` or `file` URL of one file, in Lean's standard kernel
  export format (lean4export NDJSON), that contains every claim, definition and
  axiom together with everything they depend on.

The source is not part of the proved statement. It is an untrusted pointer: a
recipient checks the file with Nanoda and accepts it only if it reproduces every
certified identity. A wrong source can make matching fail, but cannot make a
different statement match, and a source can move without re-proving.

`zklean prove` writes the export it proved from next to the certificate, ready
to publish. That export contains the proofs. A provider who keeps its proofs
private publishes instead the export of a specification module that states its
claims as `axiom`s; the identities are the same.

[ENCODING.md](docs/ENCODING.md) defines identities, the committed statement and
the proof encoding.

### 3.4. Verification

Verification succeeds only when:

- the certificate is well formed,
- every `axioms` entry equals an entry of the client's policy, by name and identity, and
- the Groth16 proof verifies against the pinned verifier key and the statement digest.

A verifier MUST NOT accept a verifier key from the certificate.

Certificates MAY be generated offline and reused indefinitely.

## 4. Requirements

A requirement is what a recipient's own proofs assume:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Client.stock_conserved": "…" },
  "definitions": { "Inventory.POST_reservations": "…" }
}
```

`zklean requirements` computes it from local Lean sources. The claims must be
propositions, but need no proof; they MAY be axioms. Because identities depend
only on statements, a provider can publish a specification module that states
its guarantees as axioms. Recipients compile that module, and its identities
equal the certified theorems' identities.

A certificate satisfies a requirement when every required claim and definition
appears in it with the same identity.

To read a certificate's definitions, `zklean fetch` downloads its source, checks
it with Nanoda, and recomputes every identity. A mismatch means the source is not
what was certified. Nothing fetched is executed: an export is data, kernel terms
that only the checker interprets.

## 5. Command-line interface

```sh
zklean check --project inventory --module V1 \
  --claims Inventory.reservation_safe --definitions Inventory.POST_reservations \
  --axioms propext
zklean prove … --source https://acme.example/reservation.ndjson --out reservation.json
zklean verify --certificate reservation.json --axioms propext
zklean fetch --certificate reservation.json --out reservation.ndjson
zklean requirements --project client --module Bridge \
  --claims Client.stock_conserved --out requirements.json
```

- `check` checks the derivation and prints the statement, without proving.
- `prove` also generates the Groth16 proof, and writes the certificate and its
  source export (`reservation.json`, `reservation.ndjson`). `--source` is the URL
  where the export will be published.
- `fetch` downloads the source, checks it and matches every identity.
- `--axioms` names permitted axioms. Lean's standard axioms resolve to pinned
  identities; others need `--axiom-policy FILE`, a JSON map from name to identity.

## 6. References

- [Lean 4](https://github.com/leanprover/lean4)
- [lean4export](https://github.com/leanprover/lean4export)
- [Nanoda](https://github.com/ammkrn/nanoda_lib)
- [SP1](https://github.com/succinctlabs/sp1)
- [Encoding profile](docs/ENCODING.md)
