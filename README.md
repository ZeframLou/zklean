# ZKLean and HTTPV

**ZKLean** is a command-line tool for checking Lean mathematical specifications
and making the results inexpensive for others to verify.

**HTTPV** is a separate HTTP protocol and TypeScript library for discovering
API specifications and checking whether they meet a client's requirements.
ZKLean works without an HTTP server; HTTPV uses certificates generated separately.

## Why this matters

A checkout service needs inventory reservations to be backed by available stock.
If its supplier starts accepting backorders, that assumption no longer holds.
Clients need to check whether an API's advertised guarantees still meet their
requirements after an update.

## How ZKLean works

Lean expresses the inventory rules mathematically. A formal verification proof
establishes that the modeled reservation operation obeys those rules.

ZKLean checks that mathematical argument and uses SP1 to produce a small
cryptographic proof that the check succeeded. Recipients verify this evidence
without downloading and rechecking the original Lean argument.

## How HTTPV works

HTTPV can discover these certificates over HTTPS and periodically check whether
the advertised guarantees still satisfy a client's requirements. Compatibility
needs an exact match under the same definitions or a separately verified Lean
argument establishing the implication.

## What clients still trust

Clients verify the mathematical claims themselves, but must trust the server to deploy matching code and honor the specification in every response. HTTPV cannot detect a server violating that specification or changing behavior without updating its advertisement. Each client chooses which axioms (assumptions) to trust and what to do when compatibility cannot be verified.

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

See [HTTPV integration](docs/HTTPV.md), the [protocol specification](SPEC.md),
[proof formats](docs/ENCODING.md), and [source build instructions](docs/DEVELOPMENT.md).
