# Test artifacts

The `.ndjson` files are lean4export output for `examples/lean` with Lean
v4.36.0-rc1 and exporter commit df81913eee5519d5a88ae5b0fd701b5298cc29ab.
Regenerate them with `bun scripts/export-examples.ts`.

- `v1.ndjson`: the inventory example, with `Init`.
- `identity.ndjson`: a one-line theorem, the source of the real certificate.
- `composition.ndjson`: several polymorphic claims with universe parameters.
- `axioms.ndjson`, `axiom-spoof.ndjson`: custom axioms, and a fake `propext`.
- `prop-def.ndjson`: a Prop-valued definition, whose body must be in its identity.

`identity.certificate.json` is a real SP1 5.2.4 Groth16 certificate for
`identity.ndjson`, proved with the guest pinned in `src/guest.json`.
