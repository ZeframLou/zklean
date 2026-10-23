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

## Install

The release is self-contained on Linux x86-64. It includes the CLI, Lean,
lean4export, the checked guest, the CPU prover, and the offline verifier:

```sh
curl -fsSL https://raw.githubusercontent.com/ZeframLou/zklean/main/install.sh | sh
```

The installer verifies the release checksum and writes to `~/.local` by default.
Set `ZKLEAN_PREFIX` to choose another location. Run `zklean doctor` to see the
resolved bundled tools.

## Certify a Lean module

No intermediate export or verifier configuration is needed:

```sh
zklean prove --project ./my-lean-project --module Contracts.Transfer \
  --claims Transfer.transfer_safe --out transfer.certificate.json

zklean verify --certificate transfer.certificate.json
```

`prove` builds the module with the bundled pinned Lean toolchain, exports the
requested closure, checks it with Nanoda inside SP1, creates a local compressed
STARK proof, verifies that proof, and writes the certificate. Add trusted axioms
explicitly with `--axioms A,B`; ZKLean never infers axiom trust.

Create a client requirement snapshot with its transitive source manifest:

```sh
zklean requirements --project ./my-lean-project --module Client.Requirements \
  --claims Client.requires_auth --out Client.Requirements.lean.httpv.json
```

`zklean check` performs the fast kernel check without proving. `zklean export`
and `--export FILE` remain available for build pipelines that want intermediate
artifacts. CPU proving is substantially heavier than checking or verification,
but requires no network, Docker, Rust, Bun, SP1 installation, or proving account.

## Build from source

Contributors need Bun, stable Rust, SP1 5.2.4, Rust 1.91.1 for its guest compiler,
and Lean 4.36.0-rc1. The release workflow packages these dependencies so end users
do not install them separately.

```sh
bun install --frozen-lockfile
bash scripts/prepare-sp1.sh
bash scripts/build-guest.sh
cargo build --release --locked -p zklean-native --features execute
bash scripts/setup-exporter.sh
bun run check
```

`prepare-sp1.sh` installs the checksum-pinned public recursion-key map from the
SP1 GitHub source release. SP1 itself is used unmodified. `scripts/package-release.sh`
builds the self-contained archive used by the one-command installer.

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

Create a requirement snapshot directly from its Lean module:

```sh
zklean requirements --project examples/lean --module Requirements \
  --claims Client.requires_auth \
  --out examples/lean/Requirements.lean.httpv.json
```

A `.lean` path loads its `.httpv.json` sidecar and verifies every source, project
file, imported module, and toolchain artifact recorded when it was generated.
JSON requirement snapshots can be passed directly. The snapshot contains the
complete resolved formal model; matching names with different definitions is
insufficient.

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
