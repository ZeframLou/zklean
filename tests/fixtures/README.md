# Test artifacts

The `.ndjson` files are actual lean4export 3.1.0 output from `examples/lean` with
Lean v4.36.0-rc1 and exporter commit df81913eee5519d5a88ae5b0fd701b5298cc29ab.
Regenerate with `bun scripts/export-examples.ts PATH_TO_LEAN4EXPORT`.

Fixtures include valid proofs, explicit axiom assumptions, a valid compatibility
bridge, and changed types/definitions behind identical names. Negative tests
also corrupt proof terms and request absent/axiom declarations as claims.

The HTTP transport E2E tests check these exports with the real Nanoda checker,
then sign statements with a test-only Ed25519 authority. That adapter is confined
to `tests/helpers.ts`; the production native backend only accepts SP1 compressed
STARK proofs. `guest.e2e.test.ts` executes the real compiled SP1 guest when
`ZKLEAN_GUEST_ELF` is provided.
