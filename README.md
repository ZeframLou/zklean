# ZKLean

ZKLean lets anyone check that a Lean theorem has been proved, without the
proof, its definitions or a Lean installation.

Lean describes software behaviour mathematically, and a **formal proof**
establishes a property of that model under stated assumptions, called axioms.
ZKLean runs an independent Lean checker inside [SP1](https://github.com/succinctlabs/sp1),
which produces a **cryptographic proof** that the checker accepted the
argument. A certificate names each proved claim and each axiom it uses by a
content **identity**, a hash of the declaration and everything it depends on,
and links to one Lean export holding those definitions. The realistic inventory
example below has a 381 KB Lean export and a 624-byte certificate.

## Trust model

A verifier trusts the checker identified by its pinned key, SP1's cryptography,
and the axioms it permits by identity. Acceptance establishes that the certified
statements follow from those axioms; you decide whether they say what you need.

## Certify an inventory reservation

[`examples/lean/Inventory.lean`](examples/lean/Inventory.lean) models a
reservation for one product, and [`V1.lean`](examples/lean/V1.lean) proves that a
successful reservation is positive, fits in stock and conserves units. Check
the proof directly:

```sh
bun src/cli.ts check --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext
```

`check` prints the certificate's statement. `prove` also generates the Groth16
proof, which takes tens of minutes and several GB of memory:

```sh
bun src/cli.ts prove --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://example.com/reservation.ndjson --out reservation.json
bun src/cli.ts verify --certificate reservation.json --axioms propext
```

`propext` is an axiom Lean's arithmetic library uses; only axioms you allow are
accepted.

See the [usage guide](docs/USAGE.md), the [certificate specification](SPEC.md),
the [encoding](docs/ENCODING.md) and [contributing](CONTRIBUTING.md).
[HTTPV](https://github.com/ZeframLou/httpv) builds on ZKLean to certify HTTP APIs.
