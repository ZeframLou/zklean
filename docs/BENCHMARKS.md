# Measure complete certificates and verification

A certificate holds one 32-byte identity per claim and used axiom,
plus 260 bytes of Groth16 evidence. Its size depends on how many names it lists,
not on the size of the proofs or definitions behind them, plus one source URL.

## Complete sizes

Canonical certificate sizes in bytes, without JSON whitespace or transport
compression. The evidence has a fixed length, so these sizes are exact.

| Workload | Lean export | Certificate | Export / certificate |
| --- | ---: | ---: | ---: |
| Propositional identity | 722 | 541 | 1.3× |
| Polymorphic pipeline composition | 7,742 | 632 | 12× |
| Inventory reservation (`V1`, with `Init`) | 381,561 | 624 | 611× |

The inventory certificate lists one claim and `propext`, and a 38-character
source URL. Its export includes the proofs of every `Init` lemma the proof uses;
none of that reaches the certificate.

## Verification costs

Each cell gives first call / median of seven subsequent calls / minimum of
those seven calls, in milliseconds. Result caching is disabled.

| Workload | Direct Nanoda | Native Groth16 | Embedded WebAssembly Groth16 |
| --- | ---: | ---: | ---: |
| Identity | 12.91 / 2.48 / 2.06 | 280.06 / 281.75 / 271.10 | 358.20 / 348.69 / 340.28 |
| Pipeline | 3.59 / 3.65 / 3.28 | 288.40 / 281.16 / 275.39 | 357.29 / 341.21 / 340.78 |

The benchmark independently checks each original export and requires the resulting
statement to equal the certificate's authenticated statement. Both examples use
an empty, locally selected axiom allowlist. Every measured cryptographic check
must succeed. Native measurements include process startup and JSON exchange;
direct checking includes identity computation. SDK verification includes
certificate parsing, axiom policy, and hashing. File reads and the
initial JSON decoding happen before timing. The first embedded measurement
includes worker startup and WebAssembly compilation/instantiation. Later
measurements, including the pipeline’s first call, reuse an idle worker and its
instance. Pairing work runs outside the application event loop in one shared worker.

Measurements used a Linux x86-64 AMD EPYC 9V74 virtual machine with a four-CPU
quota and 16 GiB memory limit, Bun 1.4.4, Rust 1.99.1, and unchanged upstream SP1
5.2.4. Verification used the portable native build with `prover,execute` enabled.
No network service or GPU was used. Raw results are in
[benchmark-results.json](benchmark-results.json).

## Proof generation resources

Both real certificates passed the upstream native SDK, lightweight native
verifier, explicit WebAssembly backend, and default SDK verification. Generation
used official checksum-pinned ceremony artifacts and the same pinned guest/key
as the shipped verifier. These measurements used a separate host prover compiled
with `RUSTFLAGS='-C target-cpu=native'`; distribution keeps a portable binary.

| Workload | Guest cycles | Wall time | Peak native process RSS |
| --- | ---: | ---: | ---: |
| Identity | 827,835 | 1,496 s (25 min) | 12,717,008 KiB (12.1 GiB) |
| Pipeline | 11,482,006 | 3,384 s (56 min) | 12,969,308 KiB (12.4 GiB) |

Both runs used `RAYON_NUM_THREADS=2`, `GOMAXPROCS=2`, `GOMEMLIMIT=6GiB`,
`GOGC=20`, `TRACE_GEN_WORKERS=1`, `CHECKPOINTS_CHANNEL_CAPACITY=1`, and
`RECORDS_AND_TRACES_CHANNEL_CAPACITY=1`. Raw resource reports are
[identity-generation.json](identity-generation.json) and
[composition-generation.json](composition-generation.json). RSS excludes other
processes and filesystem cache. An earlier portable attempt exceeded the 16 GiB
cgroup limit after 22 minutes while large archives occupied RAM-backed temporary
storage; successful runs kept those archives on disk. These observations do not
guarantee a minimum memory requirement.

The inventory example executes 353,114,958 guest cycles. No inventory Groth16
generation time or memory measurement is reported. Large CPU workloads can take
hours; measure them against the deployment's resource budget.

## Reproduce

From a source checkout with the [development tools](DEVELOPMENT.md) installed,
benchmark the committed real certificates without regenerating their proofs:

```sh
cargo build --release --locked -p zklean-native --features prover,execute
ZKLEAN_PROFILE=tests/fixtures/identity.verifier.json bun scripts/benchmark.ts \
  tests/fixtures/identity.certificate.json \
  tests/fixtures/composition.certificate.json
```

To regenerate the certificates, install the proving circuits, build the pinned
guest, and use a timeout appropriate for CPU proving:

```sh
bun src/cli.ts pin --out examples/generated/verifier.json
bun src/cli.ts prove --export tests/fixtures/identity.ndjson \
  --claims Demo.identity --timeout 10800000 \
  --out examples/generated/identity.groth16.json
bun src/cli.ts prove --export tests/fixtures/composition.ndjson \
  --claims Pipeline.compose,Pipeline.weaken --timeout 10800000 \
  --out examples/generated/composition.groth16.json
ZKLEAN_PROFILE=examples/generated/verifier.json bun scripts/benchmark.ts \
  examples/generated/identity.groth16.json \
  examples/generated/composition.groth16.json
```

Prepared distribution files include the two certificates, their verifier profile,
and original exports in `benchmarks/`. An installed CLI can verify either
certificate directly, for example
`zklean verify --certificate benchmarks/composition.certificate.json`.
