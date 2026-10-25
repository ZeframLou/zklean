# Test artifacts

The `.ndjson` files are lean4export output for `examples/lean` with Lean
v4.36.0-rc1 and exporter commit df81913eee5519d5a88ae5b0fd701b5298cc29ab.
Regenerate them with `bun scripts/export-examples.ts`.

- `v1.ndjson`: the inventory example, with `Init`.
- `identity.ndjson`: a one-line theorem, the source of the real certificate.
- `composition.ndjson`: several polymorphic claims with universe parameters.
- `axioms.ndjson`, `axiom-spoof.ndjson`: custom axioms, and a fake `propext`.
- `prop-def.ndjson`: a Prop-valued definition, whose body must be in its identity.
- `mutual*.ndjson`: a mutual block, the same block with a renamed constructor
  and reordered, and a nested inductive.
- `kernel-spoof.ndjson`: a redefined `Nat.gcd` that would prove `False`.
- `v1-spec.ndjson`: the inventory claim stated as an axiom, without its proof.
- `chain.ndjson`: a 2,000-deep chain of definitions.

`identity.certificate.json` is a real SP1 5.2.4 Groth16 certificate for
`identity.ndjson`, which must be re-proved whenever the guest in
`src/guest.json` changes.
