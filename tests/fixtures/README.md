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

`identity.certificate.json` is a **real locally generated SP1 compressed STARK
proof**, not a test signature. `identity.verifier.json` records its trusted guest
key, fingerprint, ELF digest, and SP1 version. CI rebuilds the current guest and
requires all three key identities to match this fixture. The crypto E2E test
verifies it with the unchanged upstream SDK and rejects a tampered axiom list and
wrong key pin. It deliberately uses no original Lean proof or ELF during
verification. This key is test data, not a default production trust policy.

Regenerate using `zklean pin` and `zklean prove` on `identity.ndjson`, then verify
the resulting certificate with `zklean verify` before replacing the fixture.
