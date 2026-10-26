# Test artifacts

These are the inputs to the end-to-end tests. The `.ndjson` files are lean4export output for `examples/lean` with Lean
v4.35.0 and exporter commit 5a9a355dc6c5fd82b69058d433e2ae2e8dfbf8fe.
Regenerate them with `bun scripts/export-examples.ts`.

- `v1.ndjson`: the inventory example, with the parts of Lean's `Init` library
  it depends on.
- `identity.ndjson`: a one-line theorem, the source of the test certificate.
- `percent.ndjson`: the README's progress-bar example, the source of its
  certificate.
- `composition.ndjson`: several polymorphic claims with universe parameters.
- `axioms.ndjson`, `axiom-spoof.ndjson`: custom axioms, and a fake `propext`.
- `prop-def.ndjson`: a Prop-valued definition, whose body must be in its identity.
- `mutual.ndjson`, `mutual-variant.ndjson` (a constructor renamed) and
  `mutual-swapped.ndjson` (the block reordered): a mutual inductive block. Each
  file also contains a nested inductive.
- `kernel-spoof.ndjson`: a redefined `Nat.gcd` that would prove `False`.
- `v1-spec.ndjson`: the inventory claim stated as an axiom, without its proof.
- `chain.ndjson`, `deep.ndjson`: a 2,000-deep chain of definitions and a
  5,000-deep `let` chain.

`identity.certificate.json` and `percent.certificate.json` are real SP1 6.10.0
Groth16 certificates for `identity.ndjson` and `percent.ndjson`. Both must be
re-proved whenever the guest in `src/guest.json` changes. Their `source` names
the file at the v0.1.0 tag.
