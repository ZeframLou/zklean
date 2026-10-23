# ZKLean & HTTPV

## Motivation

A formally verified client can depend on assumptions about remote APIs. Those
APIs evolve independently: a server update can invalidate the assumptions behind
the client's proof.

ZKLean turns Lean proofs into portable cryptographic certificates. HTTPV lets
clients discover the formal guarantees advertised by an API, check whether those
guarantees satisfy their requirements, and recheck when the advertised contract
changes. Together, they support compositional formal verification across
independently maintained software.

## Goals

- Make large formal proofs succinct and inexpensive to verify.
- Expose the exact propositions, definitions, and trusted axioms being certified.
- Check whether a dependency's updated guarantees still satisfy a client's assumptions.
- Let clients choose how to handle incompatible or unverifiable dependencies.
- Work with existing HTTP/HTTPS applications and ordinary request semantics.

## Security model and assumptions

A ZKLean certificate establishes that its Lean propositions have valid derivations
under the axioms it declares. Verification depends on the soundness of the Nanoda
proof checker, its implementation of Lean's kernel semantics, and the SP1 proving
system. Clients must pin a trusted verifier identity and explicitly permit every
axiom used by the proof. A certificate cannot choose its own trusted verifier.

HTTPV uses HTTPS to authenticate the certificate advertised for an endpoint and
HTTP method. **Clients trust the provider to implement and deploy the behavior
described by that certificate.** HTTPV does not attest to deployed code or prove
that individual responses obey the contract. A client's guarantees remain
conditional on its dependencies satisfying their advertised specifications.

A valid certificate alone does not establish compatibility. The remote guarantees
must establish the client's requirements through an exact match or a separately
verified Lean implication proof, using compatible definitions. Matching theorem
names is insufficient. Clients also decide whether those formal requirements
adequately capture the behavior they need.

Periodic checks observe the currently advertised contract. They cannot guarantee
stability between checks or detect behavior changes hidden behind an unchanged
advertisement. Applications choose their response to missing, invalid, or
incompatible contracts.

The current compressed STARK proof format makes no witness-privacy guarantee.
Certificates expose their formal model and axioms; they do not establish the
truth of external axioms.

## Install

From a repository checkout on Linux x86-64, download the `zklean-linux-x64`
artifact from a successful [Package run](https://github.com/ZeframLou/zklean/actions/workflows/release.yml)
and extract it into `dist`. Then run:

```sh
ZKLEAN_RELEASE_BASE="file://$PWD/dist" sh install.sh
export PATH="$HOME/.local/bin:$PATH"
```

The installer sets up the CLI and pinned Lean toolchain. Using the CLI requires
no separate Rust, Bun, or SP1 installation. Run `zklean doctor` to check the setup.
For a source build, see [Development](docs/DEVELOPMENT.md).

## Check and certify a Lean proof

The included [Identity example](examples/lean/Identity.lean) proves `P → P`
without axioms. From the repository root:

```sh
zklean check --project examples/lean --module Identity --claims Demo.identity

zklean prove --project examples/lean --module Identity --claims Demo.identity \
  --out identity.certificate.json

zklean verify --certificate identity.certificate.json
```

`check` checks the Lean proof without generating a certificate. `prove` builds
and checks the module, generates a local cryptographic proof, verifies it, and
writes the certificate. `verify` checks that certificate without the original
Lean proof terms; success returns `"status": "verified"` and exit code zero.

Even small proofs can take several minutes and multiple gigabytes of RAM to
generate. Certificates can be reused for the same statements.

For your own project, replace the project directory, module, and claim names.
No axioms are permitted by default. Pass `--axioms A,B` to both `prove` and
`verify` when those axioms are part of your trust policy. Run `zklean --help`
for the remaining commands.

## Use certificates over HTTP

An HTTPV server advertises certificates for its routes through `OPTIONS`
requests with `Accept: application/httpv+json`. Normal application requests
continue through the existing handler.

A client retrieves the certificate, verifies its proof and axiom policy, and
checks whether the advertised guarantees establish its requirements. It can
monitor the endpoint and apply its own policy when that result changes.
Verification and compatibility checking run through the TypeScript library on Bun.

The [upgrade example](examples/upgrades.ts) contains a complete client and server.
It demonstrates an API upgrade that preserves the client's requirements, a change
that breaks them, and a separate Lean proof of compatibility. After completing
the [source setup](docs/DEVELOPMENT.md), run:

```sh
bun scripts/prove-examples.ts
bun run example
```

See [SPEC.md](SPEC.md) for the protocol and integration APIs, and
[Encoding](docs/ENCODING.md) for certificate formats and compatibility rules.
