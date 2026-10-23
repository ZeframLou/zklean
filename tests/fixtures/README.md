# Test artifacts

The `.ndjson` files are actual lean4export 3.1.0 output from `examples/lean` with
Lean v4.36.0-rc1 and exporter commit df81913eee5519d5a88ae5b0fd701b5298cc29ab.
Regenerate with `bun scripts/export-examples.ts PATH_TO_LEAN4EXPORT`.

Fixtures include valid proofs and explicit axiom assumptions. Negative tests
corrupt proof terms and request absent or axiom declarations as claims.
Negative tests reject unknown fields, multiple variant tags, and duplicate JSON
keys (including escaped keys) before the checker and model projection can diverge.
`proof-data.ndjson` covers a computational definition containing embedded evidence;
that evidence is retained while standalone theorem bodies are excluded.
`composition.ndjson` covers multiple polymorphic guarantees, universe parameters,
and resolved definitions for composed stages and weaker postconditions.

`guest.e2e.test.ts` executes the real compiled SP1 guest when
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
