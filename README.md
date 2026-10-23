# ZKLean & HTTPV

ZKLean proves that Lean 4 propositions were checked by Nanoda under an explicit
axiom policy. HTTPV discovers those certificates over HTTPS, checks whether
advertised contracts establish a client's requirements, and monitors changes.

This experimental implementation targets **Bun + TypeScript** and uses **local
SP1 5.2.4 compressed STARK proofs**. It includes a real Nanoda SP1 guest, a local
CPU prover, and an offline verifier with pinned production recursion keys.
[SPEC.md](SPEC.md) describes the protocol; [docs/ENCODING.md](docs/ENCODING.md)
specifies the wire profile and compatibility rules. SP1 is used unmodified;
compressed proofs are verified through its upstream SDK.

## Build and test

Install Bun 1.3+ and stable Rust, then:

```sh
bun install --frozen-lockfile
bash scripts/prepare-sp1.sh
cargo build --release --locked -p zklean-native
bun run check
cargo fmt --check -p zklean-core -p zklean-native
```

The default tests start a real Bun HTTP server and invoke the real Nanoda checker
on committed lean4export fixtures. Transport tests use an explicitly injected,
test-only signing authority; production code has no mock backend. Cryptographic
regression tests independently verify the locally generated compressed STARK
fixture and reject tampering. Guest execution and full proving are separate
checks because they need the SP1 toolchain and more resources.

## Build the guest and local prover

Install SP1's `cargo-prove` **v5.2.4** and its `succinct-1.91.1` compiler using
[SP1's installation instructions](https://github.com/succinctlabs/sp1/tree/v5.2.4/sp1up).
Install Rust 1.91.1 as well: Cargo and the guest compiler must agree on supported
compiler flags.

```sh
rustup toolchain install 1.91.1 --profile minimal
bash scripts/prepare-sp1.sh
bash scripts/build-guest.sh
cargo build --release --locked -p zklean-native --features execute
bun src/cli.ts pin \
  --elf crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest \
  --out examples/generated/verifier.json
```

`prepare-sp1.sh` retrieves the public recursion VK map from the pinned **GitHub
source release** and validates the SDK's exact SHA-256. No S3 access, Docker,
Groth16 ceremony artifacts, or remote proving account is needed. The prover
always uses the CPU backend and enables production VK verification.

Pin and distribute the generated configuration through the client's trusted
release process. A certificate never supplies the trusted guest key. Verification
uses `binary`, the trusted serialized `verificationKey`, and its `verifierKey`
fingerprint; a local prover additionally needs the ELF path and SHA-256. Never
copy a verifier key out of an untrusted certificate.

Prove and independently verify a small axiom-free theorem locally:

```sh
bun src/cli.ts prove --export tests/fixtures/identity.ndjson \
  --claims Demo.identity --config examples/generated/verifier.json \
  --out examples/generated/identity.json
bun src/cli.ts verify --certificate examples/generated/identity.json \
  --config examples/generated/verifier.json
```

CPU proving is substantially heavier than checking or verification. The prover
uses small shards and one shard per batch to limit memory. The unchanged SP1 SDK
verifies the proof and authenticated public values before publishing a certificate.

Run the real guest's success and rejection tests:

```sh
ZKLEAN_GUEST_ELF="$PWD/crates/guest/target/elf-compilation/riscv32im-succinct-zkvm-elf/release/zklean-guest" \
  bun test tests/guest.e2e.test.ts
```

## Export a Lean project

Install [elan/Lean](https://github.com/leanprover/elan). The exporter and example
project pin Lean **v4.36.0-rc1**, and the exporter source is pinned by commit:

```sh
bash scripts/setup-exporter.sh
bun src/cli.ts export --project examples/lean --module V1 \
  --exporter .tooling/lean4export/.lake/build/bin/lean4export \
  --claims Transfer.transfer_safe --out examples/generated/transfer.ndjson
bun src/cli.ts check --export examples/generated/transfer.ndjson \
  --claims Transfer.transfer_safe
```

`check` validates proofs and prints the public statement; it does **not** create
an SP1 certificate. Use `prove` to produce a transferable certificate. Axioms must
be explicitly listed with `--axioms A,B`; they are never inferred as trusted.
Proof terms are omitted from the public formal model. The public model contains types,
definitions, certified proposition types, and all actually used axiom declarations.

Regenerate the committed export fixtures from their Lean sources with:

```sh
bun scripts/export-examples.ts .tooling/lean4export/.lake/build/bin/lean4export
```

## Client integration

```ts
import { createHTTPV, nativeBackend } from "httpv";

const trusted = await Bun.file("/opt/zklean/verifier.json").json();
const HTTPV = createHTTPV({
  backend: nativeBackend({
    binary: "/opt/zklean/zklean-native",
    verifierKey: trusted.verifierKey,
    verificationKey: trusted.verificationKey,
  }),
});
const certificate = await HTTPV.query("https://example.com/transfer", {
  method: "POST",
});
const result = await HTTPV.checkCompatibility({
  certificate,
  requirements: "./specs/remote.lean",
  allowedAxioms: [],
  // derivation: independently generated bridge certificate, when needed
});
```

The exported default `HTTPV` has no configured verifier and returns `unknown` for
verification until a configured instance is used. `verify` checks certificate
validity and axiom policy; `checkCompatibility` additionally checks the client's
requirements. Certificate validity alone does not imply compatibility.

Create a requirement snapshot from its Lean export:

```sh
bun src/cli.ts requirements --export tests/fixtures/requirements.ndjson \
  --claims Client.requires_auth --source examples/lean/Requirements.lean \
  --out examples/lean/Requirements.lean.httpv.json
```

A `.lean` path loads its `.httpv.json` sidecar and checks the direct source digest.
Regenerate sidecars when imported sources or toolchains change. JSON requirement
snapshots can be passed directly. The snapshot contains the complete resolved
formal model; matching names with different definitions is insufficient.

Exact matching accepts a certified claim with an identical resolved context.
For other implications, supply a bridge certificate. The Lean bridge may assume
remote certified claims as axioms, and must formally derive the client's required
propositions under compatible definitions. See `examples/lean/Bridge.lean`.
Missing or invalid bridge evidence returns `unknown`. Setting `mode: "exact"`
explicitly requires an exact contract; a mismatch then returns `incompatible`.

Monitor and apply an application-defined failure policy:

```ts
const monitor = HTTPV.watch({
  url: "https://example.com/transfer", method: "POST",
  requirements: "./specs/remote.lean", allowedAxioms: [], interval: 60_000,
  onChange(result) {
    if (result.status !== "verified") disableDependentFeature(result.reason);
  },
});
// On shutdown:
monitor.stop();
```

Polling starts immediately, never overlaps, and emits status/certificate changes.
`refresh()` triggers a fresh check; `stop()` or an external `AbortSignal` stops
polling. Optional `onError` receives callback errors without stopping the monitor.
Axiom policy is checked on every verification, including certificate cache hits.
Requirement files are reloaded on every refresh.

Discovery uses HTTPS, `OPTIONS`, `Accept: application/httpv+json`, `no-cache`,
`cache: no-store`, a timeout, a bounded response, and rejects redirects. Local
HTTP requires explicit `allowInsecureHttp: true`. Crypto caches never replace
fresh discovery. Results expose `status`, `reason`, `certificateId`, and `modelId`.

## Server integration

```ts
import { HTTPV } from "httpv";

Bun.serve(HTTPV.serve({
  routes: { "POST /transfer": "./certs/transfer.json" },
  fetch: existingHandler,
}));
```

The adapter reloads files/providers on each discovery request and returns
`application/httpv+json`, `Cache-Control: no-store`, and `Vary: Accept`. Normal
requests and ordinary `OPTIONS` requests go to the existing handler. Route paths
match exactly; models must identify their method, operation, and input domain.
`discoveryHandler` exposes the same Fetch handler for other lightweight adapters.

Generate real certificates and run the live upgrade example:

```sh
bun scripts/prove-examples.ts
bun run example
```

V1 accepts only authorized transfers. V2 adds a guarantee while retaining the
client's assumptions. V3 changes the operation and proposition behind the same
claim name; the client blocks dependent requests. The example also independently
checks a bridge proof against V2. These proofs can be generated offline and reused.

## Limits

HTTPV authenticates advertised formal contracts, not deployed code or individual
responses. Providers must actually implement their models. Periodic checks cannot
guarantee stability between checks. This implementation is experimental and has
not received a cryptographic or kernel-security audit. Trust includes the pinned
Nanoda checker, SP1, Lean's modeled built-ins, and the client's explicit axioms. The compressed
STARK profile makes no witness-privacy guarantee.
