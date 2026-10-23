# ZKLean & HTTPV

An API update can break the assumptions your application relies on. For example,
a payment client may depend on a transfer API rejecting unauthorized requests.
An update that allows those requests invalidates that assumption.

ZKLean and HTTPV let clients verify an API's advertised guarantees and check
whether updates still meet their requirements.

## Check specifications cheaply

1. **Prove the specification in Lean.** Use Lean to describe the API's behavior
   mathematically and prove properties of that model under stated assumptions
   (axioms). This mathematical argument is the formal verification proof.
2. **Make verification succinct with SP1.** ZKLean checks the Lean argument and
   uses SP1 to produce a small cryptographic proof that the check succeeded.
   Clients verify this proof without downloading and rechecking the original
   Lean argument.
3. **Check API compatibility with HTTPV.** Servers publish their specifications
   and cryptographic proofs over HTTPS. Clients verify them, check whether the
   specifications imply their requirements, and periodically recheck for changes.

Compatibility requires matching formal definitions and either an exact match
or a separately verified Lean argument establishing the implication.

## What clients still trust

Clients verify the mathematical claims themselves, but must trust the server to deploy matching code and honor the specification in every response. HTTPV cannot detect a server violating that specification or changing behavior without updating its advertisement. Each client chooses which axioms to trust and what to do when compatibility cannot be verified.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/ZeframLou/zklean/main/install.sh | sh
```

The installer sets up ZKLean and its dependencies on Linux x86-64.

## Try it

The [transfer example](examples/lean/V1.lean) models an API that rejects
unauthorized transfers and proves that property. Generate a certificate
containing its specification, axioms, and SP1 proof, then verify it:

```sh
git clone https://github.com/ZeframLou/zklean.git
cd zklean

zklean prove --project examples/lean --module V1 \
  --claims Transfer.transfer_safe --out transfer.certificate.json

zklean verify --certificate transfer.certificate.json
```

Successful verification returns `"status": "verified"`. Generating the SP1 proof
runs locally and can take minutes and several gigabytes of RAM; clients can reuse
the resulting certificate.

For your own project, change the directory, module, and theorem names. No axioms
are permitted by default; pass `--axioms A,B` to `prove` and `verify` to allow them.

See the [HTTPV client and server example](examples/upgrades.ts),
[protocol specification](SPEC.md), [proof formats](docs/ENCODING.md), and
[source build instructions](docs/DEVELOPMENT.md).
