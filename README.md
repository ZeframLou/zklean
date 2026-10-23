# ZKLean & HTTPV

## Motivation

A client's correctness proof may assume that a remote transfer API rejects
unauthorized requests. If the API changes that behavior, the assumption no
longer holds. Clients need a way to obtain a dependency's formal specification
and check whether its guarantees still satisfy their assumptions.

**ZKLean uses SP1 to generate succinct proofs of Lean specifications.** Clients
can verify them without downloading and checking the original Lean proof terms.
Each certificate contains the specifications, the axioms they rely on, and the
succinct proof.

**HTTPV lets clients discover and monitor the specifications advertised by API
endpoints.** When an API's specification changes, a client can reuse its own
correctness proof if the new guarantees still establish its assumptions.

## Goals

- Keep proof verification inexpensive even when the original Lean proofs are large.
- Expose the exact formal definitions and axioms behind every certified statement.
- Detect changes to advertised API specifications and verify compatibility with client requirements.
- Distinguish compatible, incompatible, and unverifiable dependencies so applications can choose how to respond.
- Integrate with existing HTTP applications without changing ordinary requests.

## Security assumptions

Verification relies on the soundness of Nanoda's Lean proof checker and SP1, a verifier key pinned by the client, and explicitly permitted axioms. HTTPS authenticates the advertised specification, and clients trust providers to implement and deploy the behavior it describes. HTTPV does not attest to deployed code or prove that individual responses satisfy that specification.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/ZeframLou/zklean/main/install.sh | sh
```

The installer sets up ZKLean and its Lean toolchain on Linux x86-64.
Run `zklean doctor` to check the installation.

## Prove and verify a specification

The [transfer example](examples/lean/V1.lean) models `POST /transfer` and proves
that a successful transfer requires authorization:

```lean
namespace Transfer

def POST_transfer (authorized : Bool) : Bool := authorized

theorem transfer_safe (authorized : Bool) :
    POST_transfer authorized = true → authorized = true := fun h => h

end Transfer
```

Generate a certificate for that theorem, then verify it:

```sh
git clone https://github.com/ZeframLou/zklean.git
cd zklean

zklean prove --project examples/lean --module V1 \
  --claims Transfer.transfer_safe --out transfer.certificate.json

zklean verify --certificate transfer.certificate.json
```

`prove` builds the Lean module, checks its proof with Nanoda inside SP1, and
writes a certificate. `verify` checks the resulting SP1 proof and axiom policy;
success returns `"status": "verified"` and exit code zero.

Proving runs locally and can take several minutes and multiple gigabytes of RAM.
The same certificate can be distributed to many clients and verified without the
original Lean proof terms.

For your own specifications, replace the project directory, module, and theorem
names. No axioms are permitted by default; use `--axioms A,B` when generating
and verifying a certificate to explicitly allow them. Use `zklean check` with
the same project, module, and claims to check a Lean proof without generating
an SP1 proof.

## Check an API dependency

Suppose a client requires the transfer API to reject unauthorized requests.
An update that adds a guarantee while preserving this requirement is compatible;
an update that allows unauthorized transfers breaks the client's assumption.

HTTPV retrieves the endpoint's advertised certificate over HTTPS, verifies its
proof and permitted axioms, then checks whether the certified guarantees imply
the client's requirement. Compatibility requires an exact match under the same
formal definitions or a separately verified Lean proof of the implication.
A valid proof of a different specification does not establish compatibility.

Clients can periodically recheck dependencies and apply their own failure policy,
such as blocking requests or switching providers. Polling observes advertised
specifications; it cannot detect behavior changes behind an unchanged advertisement
or guarantee stability between checks.

The [Bun client and server example](examples/upgrades.ts) demonstrates compatible
and incompatible API upgrades and a Lean proof of compatibility. See
[SPEC.md](SPEC.md) for the protocol and integration APIs,
[Encoding](docs/ENCODING.md) for proof formats and privacy properties, and
[Development](docs/DEVELOPMENT.md) for source builds and tests.
