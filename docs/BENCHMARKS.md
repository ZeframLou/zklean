# Measure complete certificates and verification

Groth16's evidence is 260 bytes in this profile. The complete certificate also
contains the public kernel model, encoded as base64, and the axiom list. Model
content and encoding can make that certificate larger than a small original
Lean export. Cryptographic pairing verification also has a fixed cost; direct
Nanoda checking can be faster for small proofs.

Use the same guest and checker profile for both examples. After the source
toolchain and circuit data are installed, generate real certificates:

```sh
cargo build --release --locked -p zklean-native --features prover,execute
bun src/cli.ts pin --out examples/generated/verifier.json
bun src/cli.ts prove --export tests/fixtures/identity.ndjson \
  --claims Demo.identity --out examples/generated/identity.groth16.json
bun src/cli.ts prove --export tests/fixtures/v1.ndjson \
  --claims Inventory.reservation_safe --axioms propext \
  --out examples/generated/inventory.groth16.json
bun scripts/benchmark.ts examples/generated/identity.groth16.json \
  examples/generated/inventory.groth16.json
```

The benchmark reports the complete stored and canonical certificate sizes,
decoded model size, proof size, and declaration/node counts. It compares direct
Nanoda checking with native and embedded WebAssembly verification. It checks
that every cryptographic verification succeeds, disables result caching, and
reports the first call plus seven samples' median and minimum in milliseconds.
Native measurements include process startup; SDK measurements include parsing,
model validation, axiom policy, and hashing. The first embedded call includes
WebAssembly compilation; subsequent calls reuse the compiled module.

The examples compare a small propositional identity with an inventory model
using natural numbers, options, and arithmetic proofs. They do not establish a
general proof-size or speed advantage. Reproduce the measurements on the target
hardware and use larger proof workloads before choosing a deployment policy.
