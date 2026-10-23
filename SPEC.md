# ZKLean

**Certificate specification**

## 1. Purpose

ZKLean generates succinct cryptographic certificates that Lean propositions have
valid derivations under explicitly declared axioms. Recipients verify the
certificate without receiving or rechecking the original Lean proof terms.

ZKLean is usable independently of HTTP. The separate
[HTTPV protocol](https://github.com/ZeframLou/httpv) discovers API certificates
and checks their compatibility with client requirements.

## 2. Conventions and security model

The terms MUST, MUST NOT, SHOULD, and MAY follow RFC 2119 and RFC 8174.
A specification is a Lean proposition; a certificate contains its public formal
model, actual axioms, and a cryptographic proof of successful checking.

Verification depends on the soundness of the trusted checker and cryptographic
proving system. Clients MUST pin a trusted verifier identity and explicitly
permit every axiom used by the certified derivation. Certificates establish
properties of the mathematical model; they do not attest to deployed code or
prove that individual responses implement it.

## 3. Certificates


### 3.1. Architecture

ZKLean uses three existing components:

- **lean4export:** Exports Lean 4 declarations, proof terms, and dependencies.
- **Nanoda:** Independently verifies exported Lean proof terms.
- **SP1:** Generates succinct cryptographic proofs attesting to successful verification.

```text
Lean specifications + proofs + axioms
                  |
             lean4export
                  |
           Nanoda inside SP1
                  |
          Succinct certificate
```

No custom theorem language, intermediate representation, or proof system is required beyond serialization of Lean's existing kernel expressions.

### 3.2. Certificate Generation

ZKLean accepts public specifications, their proofs, and the permitted axioms.

The SP1 guest MUST:

1. Validate the exported Lean declarations and dependency environment using Nanoda.
2. Check every proof against its corresponding specification.
3. Identify the axioms relied upon by the verified dependency closure.
4. Reject undeclared axioms and invalid dependencies.
5. Cryptographically bind the public formal model and actual axiom list to the SP1 proof.

One succinct certificate covers the entire specification set.

### 3.3. Certificate Format

```json
{
  "format": "zklean/1",
  "specs": {
    "declarations": "base64:...",
    "claims": ["Inventory.reservation_safe"]
  },
  "axioms": ["propext", "Quot.sound"],
  "proof": "base64:..."
}
```

Fields:

- `format`: Certificate format identifier.
- `specs`: Self-contained public Lean formal model.
  - `declarations`: Canonically serialized Lean kernel declarations necessary to interpret the specified propositions, including their types and definitions.
  - `claims`: Names of the propositions whose derivability is certified.
- `axioms`: Exact list of axioms relied upon by the checked proofs.
- `proof`: Succinct SP1 proof.

**The `specs` field MUST contain everything necessary to interpret the formal model**, including the relevant dependency closure of definitions, types, and axiom declarations. It MUST exclude standalone theorem bodies and unrelated declarations. Proof subexpressions inside computational definitions MAY remain when they are part of the exact declaration needed to interpret the model; proof profiles MUST state whether they provide witness privacy.

Lean's built-in semantics are fixed by the trusted proof-checker implementation. The public model MUST NOT rely on unresolved or unauthenticated external definitions.

Clients MUST be able to deserialize `specs` into a well-defined Lean formal model suitable for subsequent compatibility proofs.

All security-relevant values MUST use deterministic, versioned encoding and be cryptographically bound to the proof.

Verification MUST use a trusted, pinned SP1 verifier identity rather than one arbitrarily supplied by a certificate.

The implementation uses SP1 5.2.4 Groth16 proofs under a locally pinned checker key and the upstream circuit verification key. A certificate MUST NOT select either key. Verification MUST reject other proof formats, including legacy compressed STARK proofs.

### 3.4. Verification API

```typescript
prove(specs, proofs, allowedAxioms): Certificate

verify(
  certificate,
  allowedAxioms
): boolean
```

Verification succeeds only when the SP1 proof is valid, its authenticated public values match the certificate, and all actual axioms are permitted by the client. Axiom permissions MUST bind the complete declaration and resolved dependency context; a matching name alone is insufficient. The SDK pins Lean's standard axioms and requires explicit reviewed fingerprints for custom axioms.

The original Lean proof terms are not required for certificate verification.

Certificates MAY be generated offline and reused indefinitely for the same formally checked statements.

## 4. Command-line interface

`zklean prove` builds a Lean module, exports and checks the requested claims,
generates an SP1 certificate, verifies it, and writes the result. `zklean verify`
checks a certificate against a locally trusted verifier and explicit axiom policy.

```sh
zklean prove --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext --out reservation.json
zklean verify --certificate reservation.json --axioms propext
```

`zklean check` checks the original argument without generating an SP1 proof.
`zklean export` exposes the Lean export for build pipelines. `zklean pin` derives
a verifier profile from a locally built guest; `zklean doctor` reports the resolved
local tools. Verification does not require HTTP, a remote service, or the
original Lean proof terms.

## 5. Requirement snapshots

`zklean requirements` extracts a self-contained formal model for local client
requirements. It checks the model's declarations but does not certify that the
requirements themselves have been proved. Applications trust these snapshots
as their own requirements, not as evidence of a remote guarantee.

Snapshots have the form `{format:"zklean/requirements/1",specs}`. Source-based
generation also includes a `zklean/source-manifest/1` with source, imported
modules, project files, and toolchain artifact digests. A `.lean` path resolves
to `<path>.zklean.json`; every recorded digest MUST match before that sidecar
is used. JSON snapshots can be loaded directly.

The public TypeScript API exports `createSourceManifest` and `loadRequirements`
for applications that maintain and consume those snapshots.

## 6. References

- [Lean 4](https://github.com/leanprover/lean4)
- [lean4export](https://github.com/leanprover/lean4export)
- [Nanoda](https://github.com/ammkrn/nanoda_lib)
- [SP1](https://github.com/succinctlabs/sp1)
- [Encoding profile](docs/ENCODING.md)
