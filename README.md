# ZKLean

ZKLean is a command-line tool that makes Lean specifications inexpensive to
verify without downloading and rechecking their original mathematical arguments.

Lean describes software behavior mathematically. A **formal proof** establishes
properties of that model under stated assumptions.

ZKLean runs its checker inside [SP1](https://github.com/succinctlabs/sp1), a system
for generating cryptographic proofs of program execution. The resulting small
**cryptographic proof** certifies that the checker accepted the Lean argument.

## Trust model

A verified certificate establishes properties of the mathematical model under the axioms (assumptions) the recipient accepts. When a server advertises that model, clients still trust its deployed code and individual responses to implement it. A server can violate the model without detection while continuing to advertise the same certificate.

## Install ZKLean

```sh
curl -fsSL https://raw.githubusercontent.com/ZeframLou/zklean/main/install.sh | sh
```

The installer sets up ZKLean and its dependencies on Linux x86-64.

## Certify an inventory reservation

The [inventory example](examples/lean/Inventory.lean) models a reservation for
one product. Successful reservations must have a positive quantity, fit within
available stock, and leave `remaining + reserved = original stock`.

Generate a certificate for that guarantee, then verify it locally:

```sh
git clone https://github.com/ZeframLou/zklean.git
cd zklean

zklean prove --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext --out reservation.json

zklean verify --certificate reservation.json --axioms propext
```

The example permits `propext`, an axiom used by Lean's arithmetic library.
Successful verification returns `"status": "verified"`. Generating the SP1 proof
runs locally and can take minutes and several gigabytes of RAM; recipients can
reuse the resulting certificate.

For your own project, change the directory, module, and theorem names. Only the
axioms explicitly allowed with `--axioms` are accepted.

## HTTPV: check remote API guarantees

[HTTPV](docs/HTTPV.md) is a separate HTTP protocol and TypeScript library for
discovering API specifications, checking compatibility with client requirements,
and monitoring changes. It consumes certificates generated separately.

For example, a checkout client requires inventory reservations to be backed by
stock. HTTPV lets it detect when a supplier advertises a new contract allowing
backorders and decide whether to block requests or switch suppliers.

See the [protocol specification](SPEC.md),
[proof formats](docs/ENCODING.md), and [source build instructions](docs/DEVELOPMENT.md).
