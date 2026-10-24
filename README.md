# ZKLean

ZKLean lets recipients verify Lean specifications without downloading and
rechecking their original mathematical arguments.

Lean describes software behavior mathematically. A **formal proof** establishes
properties of that model under stated assumptions.

ZKLean runs its checker inside [SP1](https://github.com/succinctlabs/sp1), a system
for generating cryptographic proofs of program execution. The resulting
**cryptographic proof** certifies that the checker accepted the Lean argument.
A certificate bundles this proof with the specification and its assumptions.

## Trust model

You can verify certificates from an untrusted producer using a locally trusted
verifier key and explicitly permitted axioms (assumptions accepted without proof).
Verification relies on
the checker identified by that key and SP1's cryptographic guarantees. Acceptance
establishes that the certified statements follow from those axioms; you decide
whether the statements and axioms capture what you need.

## Install ZKLean

The public binary host is not published yet. Private reviewers can
[test the prepared archive locally](docs/DISTRIBUTION.md#check-the-actual-archive).
After publication, install ZKLean and its dependencies on Linux x86-64 with
one command:

```sh
curl -fsSL https://raw.githubusercontent.com/ZeframLou/zklean-dist/main/install.sh | sh
```

The binary-only distribution is prepared separately from this private source
repository; publishing it requires the steps in [Distribution](docs/DISTRIBUTION.md).
The installer downloads about 2.9 GB of upstream proving data and the pinned
Lean toolchain. The npm SDK is also unpublished. After publication, recipients
can use
`npm install zklean` with Bun 1.4.4 or newer; private reviewers can
[test prepared tarballs](docs/DISTRIBUTION.md#npm-consumers).

## Certify an inventory reservation

The [inventory example](examples/lean/Inventory.lean) models a reservation for
one product. Successful reservations must have a positive quantity, fit within
available stock, and leave `remaining + reserved = original stock`.

Check the guarantee directly before budgeting cryptographic proof generation:

```sh
cp -R examples/inventory inventory
zklean check --project inventory --module V1 \
  --claims Inventory.reservation_safe --axioms propext
```

After choosing a CPU time and memory budget, generate and verify a certificate:

```sh
zklean prove --project inventory --module V1 \
  --claims Inventory.reservation_safe --axioms propext \
  --timeout 86400000 --out reservation.json

zklean verify --certificate reservation.json --axioms propext
```

The example permits `propext`, an axiom used by Lean's arithmetic library.
Successful verification returns `"status": "verified"`. Local CPU proof generation
can take hours and needs a measured memory budget; the [benchmark guide](docs/BENCHMARKS.md)
records guest costs and resource limits. Recipients can reuse the resulting
certificate. For long runs, set `zklean prove --timeout MS`; the default is one hour.

For your own project, change the directory, module, and theorem names. Only the
axioms explicitly allowed with `--axioms` are accepted.

## Related project

[HTTPV](https://github.com/ZeframLou/httpv) is a separate HTTP protocol and
TypeScript library for discovering API specifications and checking whether they
satisfy a client's requirements.

A certificate names each claim, definition and used axiom by a 32-byte content
identity and carries a 260-byte Groth16 proof, so its size does not grow with
the proofs. The inventory example's Lean export is 381 KB; its certificate is
695 bytes. See [Benchmarks](docs/BENCHMARKS.md) for sizes and verification costs.

See the [usage guide](docs/USAGE.md), [certificate specification](SPEC.md),
[proof formats](docs/ENCODING.md), and [source build instructions](docs/DEVELOPMENT.md).
