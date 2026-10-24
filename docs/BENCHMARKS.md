# Measure complete certificates and verification

These two measured examples have 260-byte Groth16 evidence, but their complete
certificates are larger than the original Lean exports. Direct Nanoda checking
is faster than either cryptographic verifier on these workloads. The results
establish working proof generation and verification; they do not establish a
general size or speed advantage.

## Complete sizes

All sizes are uncompressed bytes. Stored certificates include JSON whitespace;
canonical certificates omit that whitespace. The public model is encoded as
base64 inside the certificate, alongside claims, axiom policy, and evidence.
HTTP wrappers and transport compression are excluded.

| Workload | Original export | Stored certificate | Canonical certificate | Decoded public model | Evidence | Declarations / kernel nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Propositional identity | 722 | 3,190 | 3,145 | 2,013 | 260 | 1 / 11 |
| Polymorphic pipeline composition and weaker postcondition | 7,745 | 37,534 | 37,482 | 27,749 | 260 | 3 / 118 |

## Verification costs

Each cell gives first call / median of seven subsequent calls / minimum of
those seven calls, in milliseconds. Result caching is disabled.

| Workload | Direct Nanoda | Native Groth16 | Embedded WebAssembly Groth16 |
| --- | ---: | ---: | ---: |
| Identity | 3.34 / 2.85 / 1.94 | 275.24 / 273.52 / 271.56 | 344.91 / 341.52 / 336.99 |
| Pipeline | 3.66 / 4.22 / 3.80 | 280.12 / 280.24 / 277.92 | 340.59 / 339.17 / 335.87 |

The benchmark independently checks each original export and requires the resulting
statement to equal the certificate's authenticated statement. Both examples use
an empty, locally selected axiom allowlist. Every measured cryptographic check
must succeed. Native measurements include process startup and JSON exchange;
direct checking includes model projection. SDK verification includes certificate
schema parsing, model validation, axiom policy, and hashing. File reads and the
initial JSON decoding happen before timing. The first embedded measurement
includes WebAssembly compilation; later measurements, including the pipeline's
first call, reuse that module.

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
