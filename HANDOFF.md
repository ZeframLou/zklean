# Handoff

## Completed review fixes

The holistic review fixes are implemented and validated. All four additional
HTTPV Groth16 certificates have been generated, authenticated, and promoted to
committed example paths. No proving process remains active.

Keep both repositories private and at version **0.1.0**. No publication, tags,
merges, releases, public host creation, or visibility changes are authorized.
Use unchanged upstream **SP1 5.2.4**; do not vendor or patch it. The existing
Nanoda patch is documented in `vendor/nanoda/UPSTREAM.md`.

- SDK: `/workspace/zklean`, branch `work`. Runtime fixes are at
  `12134df08dcfac2af4c1b1b8dc363a64bd4eb11e`; subsequent changes update handoff,
  documentation, and measurements. HTTPV's package.json records its exact SDK pin.
- HTTPV: `/workspace/httpv`, branch `fix/groth16-verification`.
  Draft PR: https://github.com/ZeframLou/httpv/pull/1 . Keep it unmerged.
  Do not push HTTPV main; use the existing fix branch.
- Read each repository's AGENTS.md. SDK proving remains independent of HTTPV.
  HTTPV uses public SDK exports and invokes the independent CLI only offline.
  Consumer installation uses npm or prepared tarballs, without private Git.

## Corrections

- Explicit tool/profile overrides fail closed. Verifier profiles validate their
  format, SP1 version, key, ELF digest/path, timeout, and supported fields.
- Source-bound requirements capture their source closure before export and
  compare it after native checking and final artifact capture. Concurrent edits,
  unrelated --source bindings, and raw-export/source combinations are rejected
  while preserving the prior output.
- Embedded verification runs outside the event loop in a shared pool of at most
  two workers and sixteen admitted jobs. Trapped/stuck workers are retired;
  retiring threads count against the budget until termination completes.
- Lean imports encode control characters correctly, scale through private
  top-level data definitions, normalize irrelevant metadata/let annotations, and
  round-trip actual String values through export/import/export.
- Model validation includes implicit Nat/String literal dependencies. Policy
  traversal errors stay inside the invalid-certificate boundary.
- HTTPV discovery explicitly binds an endpoint entrypoint to its certificate:
  `{format:"httpv/1",contracts:{POST:{operation,certificate}}}`.
  `query()` returns an Advertisement. Compatibility checks take
  `{advertisement,operation,requirements,allowedAxioms,...}`; watch also requires
  the expected operation. The advertised name and complete certified context
  must match the reviewed requirement before cache or bridge acceptance.
  A bridge cannot supply an absent operation or authorize another entrypoint.
- Static server advertisements are snapshots; providers return a complete
  operation/certificate pair. Client inputs are captured before asynchronous
  verification. Malformed discovery/options/context processing fail closed.
- HTTPV CI builds the pinned independent checker, regenerates Lean model
  fixtures, rejects source drift, and compares all four real certificates to
  their checked statements. The installed npm check runs the packaged example
  and packaged data through public APIs, without native tools or Lean.

## Validation

| Check | Result |
| --- | --- |
| Full SDK suite, real guest and Lean included | 29 pass, 0 fail, 0 skip; 141 assertions |
| Full HTTPV suite, real inventory/bridge included | 23 pass, 0 fail; 115 assertions |
| Four inventory certificates: source equality, native and default embedded verification | Passed |
| Real HTTP discovery, added guarantee, changed behavior, weaker bridge, entrypoint rebinding, tampering, request gating | Passed |
| Actual npm SDK and HTTPV consumer typechecking and native-free execution | Passed |
| Compiled SDK CLI and bare Ubuntu 22.04 archive, libexec removed | Both SDK proof fixtures passed |
| Fresh Ubuntu 22.04 installer, doctor, pin, init, real Lean inventory check | Passed locally and in hosted Package workflow |
| SDK hosted Check and Package at 007d947 | Both green; full guest suite and clean install included |
| TypeScript, formatting, source fixture regeneration | Passed |
| HTTPV hosted CI | Blocked by missing ZKLEAN_READ_TOKEN |

Final logs:
- `/tmp/httpv-finish-validation.log`
- `/tmp/httpv-full-final.log`, `/tmp/httpv-certificates-final.log`
- `/tmp/httpv-example-final.log`, `/tmp/httpv-package-final.log`
- `/tmp/zklean-full-final.log`, `/tmp/zklean-package-final.log`
- `/tmp/zklean-final-bare.log`, `/tmp/httpv-fixture-refresh.log`

HTTPV needs an Actions secret named **ZKLEAN_READ_TOKEN**, with read-only
Contents access to private ZeframLou/zklean. Never persist the broader transient
session GitHub token as that secret. Local checks passed; do not describe hosted
HTTPV CI as green until the secret is configured and the workflow succeeds.
New documentation pushes can trigger additional SDK workflow runs; inspect the
latest branch runs if a current hosted status is needed.

## Real certificates and costs

The pinned guest is unchanged:
- ELF SHA-256: `10819f2bb944e48fcbfbd5f49f47ba508bb0069a33923f8368a179e9e1bc5d37`
- Checker key: `0x00a2d646d4c4c693eec3f7f24133b648ab3332c4b6d1e079aaa401c28c0f2d89`

SDK identity/composition certificates remain in tests/fixtures. The refreshed
quiet benchmark in docs/benchmark-results.json measures the actual worker-based
backend with caching disabled. Median direct checking is 2.48/3.65 ms; native
verification 281.75/281.16 ms; embedded verification 348.69/341.21 ms. Complete
certificates are larger than the original exports. There is no measured size or
speed advantage; privacy of proof terms and recipient portability are the tradeoff.
See docs/BENCHMARKS.md and the two SDK generation resource reports.

HTTPV's new single-unit inventory model represents unbounded stock inductively
and models POST /units. Its four real certificates and the weaker requirement
snapshot are in examples/unit-inventory/certificates/{v1,v2,v3,bridge,requirements}.json.
V1 conserves stock; V2 adds success on available stock; V3 truthfully certifies a
weaker guarantee while accepting backorders; the bridge derives nonempty input
on success from conservation. This is separate from the older arbitrary-quantity
arithmetic example, whose Groth16 certificates have not been generated.

| Unit workload | Wall seconds | Peak RSS KiB | Rust workers |
| --- | ---: | ---: | ---: |
| Baseline | 7437.82 | 13452196 | 2 |
| Additional guarantee | 8391.86 | 13064868 | 2 |
| Changed behavior | 3710.86 | 13008232 | 4 |
| Weaker-requirement bridge | 5523.37 | 13436376 | 4 |

Raw reports: HTTPV docs/unit-generation.json. V1 executes 33,839,014 guest
cycles. All runs used Go workers 2, GOMEMLIMIT=6GiB, GOGC=20, trace workers 1,
and both checkpoint/record channel capacities 1. The last two used all four
available Rust workers after the user asked about speedups. Workloads differ;
do not claim a controlled twofold improvement from their wall times.
The four certificates contain genuine upstream SP1 evidence, not signatures or
manufactured proof substitutes. Transport-only tests retain a clearly isolated
signature backend.

## Environment and distribution

Source `/workspace/zklean-env.sh` for tool/cache paths. Do not change HOME.
Optimized prover: `/workspace/optimized/target/release/zklean-native`.
Portable Ubuntu 22.04 target: `/workspace/baseline/target`.
Docker builder: zklean-build:ubuntu22, explicit local Unix socket. Preserve the
proxy CA and unset the host BINDGEN_EXTRA_CLANG_ARGS inside that builder.
An alternative SP1 output directory needs an ancestor named `target`.

Official circuit archive: `/workspace/.cache/zklean-groth16.tar.gz`, SHA-256
`6cbc2c155c41001e81efd81119bd3d4f32313fcd3184df383d50225315b73104`.
Keep large archives on disk, outside RAM-backed /tmp.

The actual portable archive, checksum, installer, docs, example sources, benchmark
fixtures and prepared SDK tarball are staged in SDK dist/. The HTTPV tarball
includes its runnable unit example, formal sources, and real certificate data;
.lake and test signing helpers are excluded. Repacking never publishes anything.

The proposed public binary/docs host ZeframLou/zklean-dist has not been created
or published. Both npm packages are unpublished. README installation commands
are explicitly conditional on publication; private reviewers use tested local
archives/tarballs. Publication remains a separate maintainer action.
