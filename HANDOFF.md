# Handoff

## Active follow-up: fix the holistic review findings

The user now requests **all review issues fixed cleanly**. Work is active; the
older completed-work account below is historical until this section is removed.
Do not stop after the code fixes: finish real HTTPV crypto workflow, source drift
CI, packed consumers, portable archive, benchmarks, docs, pushes and PR metadata.
No subagents are authorized. Preserve all existing publication/privacy constraints.

ZKLean fixes now implemented: explicit tool/profile paths fail closed; source
requirements retain the pre-export source closure through native checking and
final artifact capture, reject unrelated --export/--source binding, and preserve
existing output on a concurrent edit; the default Groth16 backend uses a shared
two-worker/sixteen-job bounded pool with worker failure/deadline recovery; Lean
imports use a proper string encoder, private top-level node definitions instead
of giant nested lets, and the pinned exporter's nondependent-let normalization.
New regressions pass. Local check: **26 pass, 2 real guest tests intentionally
skipped while CPU proving is active**, 124 assertions; hosted full checks must
cover the guest. Actual packed SDK/compiled CLI worker checks passed; latest log
`/tmp/zklean-worker-package.log`. No Rust/guest changes, so the guest pin is stable.

HTTPV now requires a nonempty `operations` list on checkCompatibility and watch.
Every client-selected declaration/context must occur in the remote *claim*
closure and the requirement closure, before exact/bridge acceptance. Bridges
cannot supply an absent operation. Cache keys include bindings. Context changes
in exact mode return incompatible/operation-mismatch; implication mode returns
unknown/operation-mismatch. Tests/examples are being migrated; latest log is
`/tmp/httpv-binding-check.log`. A checked renamed Backorders operation plus the
independent inventory bridge is a regression fixture. Docs are not yet updated.

Real proof work is active, **do not kill it or run large guest execution beside
it**. Four new single-unit inventory models exercise actual POST /units,
compatible V2, backorder V3, and weaker client bridge. Sources are in HTTPV
`examples/unit-inventory/`; they reserve one unit from an inductively represented
stock count. The arbitrary-quantity arithmetic example remains separate and
expensive. V1 guest execution is **33,839,014 cycles**, with no axioms.

- Current first prover: `/workspace/optimized/target/release/zklean-native prove`.
- First report (not yet finished): `/tmp/httpv-unit-v1.generation.json`.
- Log: `/tmp/httpv-unit-v1.prove.log`.
- Certificate output: `/workspace/httpv/tests/fixtures/unit/v1.certificate.json`
  (empty until success; do not commit it until authenticated).
- A sequential runner `/tmp/httpv-unit-proof-queue.py` waits for V1's successful
  report, then generates V2, V3, bridge with the same pinned guest and resource
  settings. Live runner log `/tmp/httpv-unit-proof-queue.log`.
- Requests are `/tmp/httpv-unit-{v1,v2,v3,bridge}.request.json`; all exports were
  produced by Lean and checked. Reports/logs follow that name prefix.
- Proof output files go to `httpv/tests/fixtures/unit/*.certificate.json`.
  Verify all through native/default WASM; compare statements to regenerated
  fixtures and save resource reports only after success.

HTTPV source fixtures were regenerated with the current source CLI through
`ZKLEAN_CLI=/tmp/zklean-current-cli bun run fixtures`. The renamed catalog is now
`scripts/models.ts` (old export-examples.ts deleted); it contains existing and
new unit models. `scripts/refresh-fixtures.ts` handles each model's project and
policy; `scripts/prove-examples.ts unit` reproduces unit certificates offline.
Main inventory source/fixtures remain supported. New unit axiom pin is in
`examples/unit-inventory/axioms.json` and was computed from checked V1.

Additional follow-up implemented since this section was first written:
- Root SDK runtime pushed at c9a6176; hosted Check is green. A follow-up hardens
  worker retirement: trapped WASM instances are discarded, retiring threads count
  against the budget until termination, and an out-of-field key cannot poison a
  later valid check. Crypto regressions pass; import now round-trips actual String
  values through export/import/export (including literal escapes), and passes.
- Latest rebuilt baseline archive passed bare Ubuntu22 checksum + both real proofs
  with libexec removed: `/tmp/zklean-worker-bare.log`. Latest actual SDK tarball and
  compiled CLI checks pass: `/tmp/zklean-worker-package.log`.
- HTTPV currently pins c9a61760abe078b7874233bd74efce7dced3210e; update it to the
  follow-up runtime commit after pushing. Typecheck and 19 existing/binding tests
  pass against that SDK (`/tmp/httpv-core-fixes.log`). A full HTTPV check must wait
  for the four real fixtures, because the mandatory unit crypto test is now added.
- Real workflow implemented in `examples/unit-flow.ts` using public package APIs.
  `examples/unit-upgrades.ts`, `tests/unit-crypto.e2e.test.ts`, and the actual npm
  tarball check all run it. It covers discovery, V1/V2 acceptance, V3 request gating,
  a weaker verified bridge, and tamper rejection with default Groth16.
- Canonical real demo artifacts will live in
  `httpv/examples/unit-inventory/certificates/{v1,v2,v3,bridge}.json` plus
  `requirements.json`. **The running Python prover queue STILL writes old paths
  `tests/fixtures/unit/*.certificate.json`. After ALL FOUR SUCCEED, authenticate
  and move those outputs to the canonical example paths. Do not remove or rename
  a file while a prover still has it open.** The old duplicate unit requirements
  snapshot in tests/fixtures/unit can be removed; the canonical one is regenerated
  from source by `bun run fixtures` already.
- `scripts/models.ts` now has modelPath/certificatePath metadata; refresh writes
  native-checked models under tests/fixtures/unit and the canonical public requirement
  under examples/unit-inventory/certificates. `scripts/check-certificates.ts` must
  authenticate all four canonical certs and require their statements to equal the
  freshly checked model fixtures. No skips/fake proofs.
- HTTPV formal-artifact CI job now checks out the exact SDK development commit,
  builds its independent CLI/exporter with pinned Lean, regenerates all source
  fixtures and rejects drift, then checks real certificates. It uses the existing
  read-only ZKLEAN_READ_TOKEN prerequisite, still absent. .tooling is gitignored.
- Both README/usage guides explicitly state npm is unpublished and provide local
  tarball review. HTTPV docs/spec require explicit operation bindings, conservative
  stable contexts, correct reasons, and document the real single-unit workflow.
  HTTPV npm files include example models, real demo data, and runnable unit example;
  no .lake data. No publication/visibility/version changes.

Remaining follow-up:
1. Wait for all real proof reports and authenticate/promote the outputs as above.
   Record resource reports and actual cycles; don't run heavy guest execution during
   proving. Run complete HTTPV check, check:certificates, example:unit, and packed
   consumer against an actual SDK npm tarball with the final runtime.
2. Re-run the benchmark after proving (uncontended) with the worker backend, update
   raw JSON and guide. Re-run only affected root checks; full hosted guest checks
   already validate c9a6176, and the guest/Rust sources haven't changed.
3. Stage final SDK/npm and HTTPV/npm tarballs, ensure example links/data are actually
   present, and update docs with measured unit proving resources. The latest root
   runtime archive already passed the bare-container worker check; documentation
   data changes can be repackaged from the cached Ubuntu22 builder.
4. Finish final handoff, push both branches, update draft PR #1 title/body and CI
   status. Do not merge, publish, create tags, change visibility, or retry main push.
5. HTTPV hosted CI still needs the user's read-only Actions secret. Never persist
   the broader/transient session token. The previous user question is pending;
   no readiness/approval has been supplied. Report the external prerequisite if it
   remains unavailable. The PR attach tool hangs but has been called.


## Repositories and constraints

- `/workspace/zklean`: private `ZeframLou/zklean`, branch `work`. The default
  `main` is an obsolete specification checkpoint; continue on `work`.
- `/workspace/httpv`: private `ZeframLou/httpv`, branch
  `fix/groth16-verification`, pushed at `597036a`. Draft PR:
  https://github.com/ZeframLou/httpv/pull/1 . Its development-only SDK pin is
  `84400b836862ef9ea74355dc0a058f8f8d3f50ba`, which includes the verified runtime,
  real identity fixture, and consumer WASM asset types. Later SDK changes concern
  benchmark fixtures/docs, packaging data, and the CLI's long-run status message.
- Automatic approval review rejected a direct HTTPV `main` push because explicit
  shared-default-branch authorization was missing. The changes are safely pushed
  on the draft PR; do not retry that direct push or merge. The app attachment
  tool was called but hung; the normal PR link works.
- Both projects remain at `0.1.0`. Keep source private. No package/release
  publication, tags, merges, host creation, or visibility changes are authorized.
- Use unchanged upstream SP1 5.2.4, with no vendoring or patches. The existing
  Nanoda patch is documented in `vendor/nanoda/UPSTREAM.md`.
- ZKLean remains independent of HTTPV. HTTPV uses public SDK exports; certificate
  generation happens offline. Consumer installation uses npm, not private Git.
- Read each repository's `AGENTS.md` before editing docs. Commit and push to the
  existing work branches; preserve separate, concise trust explanations.

## Validation

| Check | Result |
| --- | --- |
| Full ZKLean suite, including real guest and Lean | 23 pass, 0 fail, 0 skip; 106 assertions |
| Native SDK, lightweight native, explicit WASM, default SDK acceptance | Both real certificates passed |
| Altered proof, different valid model, wrong key, concurrent verification | Passed |
| Authenticated CLI import, inspection, Lean compilation, failed-output preservation | Passed |
| Rust formatting/clippy; guest/fixture identity | Passed |
| TypeScript and formatting | Passed |
| Actual SDK npm tarball: installed consumer typecheck and native-free verification | Passed |
| Compiled CLI: real proof, no native tools | Passed |
| HTTPV full suite, including default real crypto | 18 pass, 0 fail; 92 assertions |
| HTTPV actual npm tarballs: installed consumer typecheck, discovery and verification | Passed |
| Fresh Ubuntu 22.04 install: automatic circuits/Lean, doctor, pin, init, inventory check | Passed |
| Final portable archive on bare Ubuntu 22.04: both real certificates and checksum | Passed |
| ZKLean hosted Check and Package at SDK pin `84400b8` | Both green |
| HTTPV hosted Check | Stops before tests: missing `ZKLEAN_READ_TOKEN` |

Logs: `/tmp/zklean-full-check.log`, `/tmp/zklean-clean-final.log`,
`/tmp/zklean-package-types-check.log`, `/tmp/zklean-release-final.log`,
`/tmp/httpv-full-final.log`, `/tmp/httpv-package-check.log`, and
`/tmp/zklean-final-artifact-verify.log`.

ZKLean hosted green runs:
https://github.com/ZeframLou/zklean/actions/runs/40045537311 and
https://github.com/ZeframLou/zklean/actions/runs/40045537300 .
The workflow prepares artifacts; its historical displayed name may be Release.
It does not publish anything.

HTTPV CI requires an Actions secret with read-only Contents access to private
`ZeframLou/zklean`. An asynchronous user question requested manual setup of
`ZKLEAN_READ_TOKEN`; no answer has arrived. Never persist the session's broader,
transient GitHub token as a CI secret. If the user confirms setup, rerun HTTPV
Check and inspect it. Otherwise record hosted CI as pending that prerequisite.

## Completed corrections

- Axiom permissions bind declarations and their full dependency context. Standard
  pins derive from Lean; custom axioms require reviewed fingerprints. Context
  matching ignores binder display names/annotations and preserves semantic names,
  types, and definition bodies. Lake resolves `srcDir`; manifests track transitive
  source changes. Verification bounds/coalesces concurrent work.
- Model handling preserves `__proto__` declarations, rejects noncanonical base64
  padding bits and unpaired Unicode surrogates, and uses UTF-8 canonical ordering.
  Native cross-language tests cover closure, names, inductive aliases, binder
  renaming, and polymorphic multi-claim checking.
- Lean imports reconstruct kernel objects through public APIs and check reused
  declarations against the authenticated context. They erase irrelevant metadata,
  support matching proof-valued definitions, and preserve existing output when
  authentication fails. Shared helper functions avoid huge generated elaborations.
- The native wrapper reserves stdout for JSON and redirects upstream gnark output
  to stderr. Bounded native diagnostic tails, CLI progress, and validated
  `--timeout MS` support long CPU runs. Large models may take hours.
- HTTPV checks every shared bridge/remote declaration, including operations outside
  the assumed theorem closures. A real Lean/Nanoda fixture reproduced false
  acceptance before the fix. The regression rejects conflicting and accepts
  matching contexts, while allowing unrelated extra remote declarations.
- The stock bridge derives the weaker conservation property. Monitor expiry,
  timeouts, stopped state, synchronous callbacks, and `requireVerified()` gating
  are implemented/documented. Default verification uses embedded Groth16 with
  no native path/profile discovery. Runtime never generates certificates.

## Real proofs and benchmark

`tests/fixtures/identity.certificate.json` and
`tests/fixtures/composition.certificate.json` are real upstream SP1 proofs using
production VK/shape checks and official ceremony artifacts. No manufactured
certificate or signature substitute is used. Both have 260 evidence bytes.
The actual guest identity matches `src/guest.json`:

- ELF SHA-256: `10819f2bb944e48fcbfbd5f49f47ba508bb0069a33923f8368a179e9e1bc5d37`
- Checker key: `0x00a2d646d4c4c693eec3f7f24133b648ab3332c4b6d1e079aaa401c28c0f2d89`
- Identity certificate ID: `4b8a989a35eb046e928e33b940f7b0c064d03254c7264bf1abf5361e7c773f4d`

See `docs/BENCHMARKS.md`, `docs/benchmark-results.json`, and the two
`docs/*-generation.json` reports. The measured complete certificates are 3,190
and 37,534 bytes, compared with exports of 722 and 7,745 bytes. Median direct
checking is 2.85/4.22 ms; native verification 273.52/280.24 ms; embedded
verification 341.52/339.17 ms. These workloads show no size or speed advantage.
The script independently checks the export/model match and a locally empty
axiom policy before timing seven uncached samples.

Generation used 4-CPU/16-GiB limits, a host-optimized native prover, two Rayon/Go
workers, `GOMEMLIMIT=6GiB`, and `GOGC=20`. Identity took 1,496 seconds and peaked
at 12.1 GiB RSS; composition took 3,384 seconds and peaked at 12.4 GiB. Both runs
finished successfully. Guest cycles: identity 827,835, composition 11,482,006,
inventory 353,114,958. No inventory Groth16 proof was generated or benchmarked.

The initial portable attempt exceeded the memory limit while large archives
occupied RAM-backed `/tmp`. Those archives now live on disk under
`/workspace/.cache/`; do not move them back to tmpfs. Official circuit archive:
`/workspace/.cache/zklean-groth16.tar.gz`, SHA-256
`6cbc2c155c41001e81efd81119bd3d4f32313fcd3184df383d50225315b73104`.
No proving process remains active. Generated proofs/logs are in
`examples/generated/` and `/tmp/zklean-*-prove*`.

## Tools and distribution

Source `/workspace/zklean-env.sh` for this environment's tool/cache paths. Fresh
environments must provision documented dependencies. Do not change HOME.
The optimized prover is `/workspace/optimized/target/release/zklean-native`;
the portable Ubuntu 22.04 build target is `/workspace/baseline/target`.
Docker builder image `zklean-build:ubuntu22` remains available. Use the explicit
local socket, preserve proxy/CA trust, and unset the host's
`BINDGEN_EXTRA_CLANG_ARGS` inside that builder. The SP1 build script needs an
ancestor named `target`; do not rename that target directory.

`scripts/package-release.sh` always rebuilds `prover,execute`, because test
helpers can overwrite the target with fewer features. It compiles Bun's baseline
x86-64 runtime. `dist/zklean-linux-x64.tar.gz` and checksum are staged, with
installer, README, specification, docs/raw benchmark reports, example Lean
sources, and benchmark certificates/exports/profile. Docs/data copy changes
were repackaged after the final runtime archive passed the clean checks above.

The installer automatically fetches checksum-pinned proving circuits and pinned
Lean. End users need no Go, Rust, Docker, Bun, private Git credentials, or native
verifier configuration. The proposed public binary/docs host is
`ZeframLou/zklean-dist`; it has not been created or published. The one-command
public install remains conditional on that maintainer step. Concrete local
installation uses `ZKLEAN_RELEASE_BASE=file://...` and is already validated.
No source visibility or package publication has changed.
