# Using ZKLean

This guide is for two kinds of user:

- **Authors** have Lean proofs about their software and want to publish
  certificates of them.
- **Recipients** receive certificates and want to verify them, read what they
  claim, or build their own proofs on top of them.

The [README](../README.md#concepts) defines the terms used here: claims, axioms,
identities and certificates.

## Set up

Recipients who only verify certificates need just the TypeScript SDK
(`bun add zklean@0.1.0`) and can skip to
[Verify a certificate](#verify-a-certificate).

The command-line tool, which checks and proves Lean modules, runs from a
release checkout. It needs [Bun](https://bun.sh/) 1.4.4 or newer, stable
[Rust](https://rustup.rs/), and [Lean](https://lean-lang.org/install/) 4.35.0
with its build tool Lake:

```sh
git clone --branch v0.1.0 https://github.com/ZeframLou/zklean.git
cd zklean
bun install --frozen-lockfile
bash scripts/setup-exporter.sh   # builds lean4export, which writes Lean declarations to a file
cargo build --release --locked -p zklean-native
alias zklean="bun $PWD/src/cli.ts"
```

This guide writes the tool as `zklean`, as the alias above defines it.

Proving also needs a build that includes SP1's prover, which needs Go 1.24,
`protoc` and a C compiler to compile, and the release's **guest**: the compiled
checker program SP1 runs, `zklean-guest`:

```sh
GOFLAGS=-buildvcs=false cargo build --release --locked -p zklean-native --features prover,execute
curl -fLO https://github.com/ZeframLou/zklean/releases/download/v0.1.0/zklean-guest
export ZKLEAN_GUEST_ELF="$PWD/zklean-guest"
```

The first proof downloads SP1's proving files, about 6.2 GB, to
`~/.sp1/circuits`.

## Certify a module

Start by checking your proofs. This runs Nanoda, the independent Lean checker,
without any cryptography:

```sh
zklean check --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext
```

`check` prints the **statement** a certificate would prove: each claim and each
axiom the proofs use, by name and identity. `--axioms` names the axioms you
allow; `check` fails if the proofs use any other. Instead of `--project` and
`--module`, every command that reads Lean code also accepts an existing export
as `--export FILE`.

Then generate the certificate:

```sh
zklean prove --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://acme.example/reservation.ndjson --out reservation.json
```

`prove` runs the same check inside SP1. For this example that takes about 5 to
15 minutes and up to 20 GB of memory on a 12-core machine; time grows with the
size of the export, and `--timeout MS` raises the one-hour default limit. It
writes the certificate,
`reservation.json`, and beside it `reservation.ndjson`, the **export**: a file
of the Lean declarations the identities are computed from, in lean4export's
format.

Publish the export at the `--source` URL, so recipients can see what your claims
mean. The export also contains your proofs. To keep them private, write a
module that states each claim as an `axiom` instead of proving it, as
[`examples/lean/V1Spec.lean`](../examples/lean/V1Spec.lean) does, and publish
its export instead. A claim stated as an axiom has the same identity as the
proved theorem, so the certificate still matches:

```sh
zklean export --project examples/lean --module V1Spec \
  --claims Inventory.reservation_safe --out reservation.ndjson
```

The certificate never contains your proofs, but ZKLean does not promise that its
cryptographic proof reveals nothing about them.

## Verify a certificate

```sh
zklean verify --certificate reservation.json --axioms propext
```

From TypeScript:

```ts
import { createVerifier, standardAxioms } from "zklean";

const result = await createVerifier().verify(
  await Bun.file("reservation.json").json(),
  { axioms: { propext: standardAxioms.propext } },
);
if (result.status !== "verified") throw new Error(result.reason);
```

Verification needs no native code, Lean or network access, and runs in a
background worker so it does not block your program. It checks the
cryptographic proof against the verifier key built into the SDK, never a key
supplied by the certificate, so a certificate cannot choose which checker it
claims to come from.

## Read what a certificate claims

A certificate names its claims by identity. To see the definitions behind them,
fetch its export:

```sh
zklean fetch --certificate reservation.json --axioms propext --out reservation.ndjson
```

`fetch` verifies the certificate, downloads the export from its `source` URL,
checks it with Nanoda, and saves it only if it reproduces the identity of every
claim and every non-standard axiom; otherwise it lists the mismatches and exits
with status 1. `--from FILE` checks a local copy instead. Nothing fetched is
executed.

An export holds Lean's compiled form of the declarations rather than readable
source. To read the definitions, or to write proofs that use them, get the
author's Lean source from anywhere, then confirm it is the certified model:
export it with `zklean export` and check that export with
`zklean fetch --certificate … --from FILE`.

## Depend on a certified claim

Your own proofs can assume another project's claims. **Requirements** record
which claims you rely on, by name and identity, so you can later confirm that a
certificate still proves them. Write your proofs against the author's Lean
module, then generate your requirements:

```sh
# client and Remote stand for your own project and the module importing the author's code.
zklean requirements --project client --module Remote \
  --claims Inventory.reservation_safe --out requirements.json
```

A certificate satisfies your requirements when every required claim appears
among its claims with the same identity. In the SDK, verify the certificate
first, then call `satisfies(certificate, requirements)`. To rely on a weaker
property, prove it from the author's claim in your own module, and require the
author's claim rather than your derived one. Regenerate the requirements
whenever the Lean code they come from changes.

## Choose axioms

A certificate is only as good as the axioms it assumes, so verification accepts
only axioms you name. Lean's standard axioms, `propext`, `Quot.sound` and
`Classical.choice`, resolve to identities pinned to Lean 4.35.0. Any other axiom
needs its identity in an `--axiom-policy` file, a JSON object mapping axiom
names to identities that you review independently of the certificate's author,
and its name in `--axioms`:

```sh
zklean verify --certificate reservation.json \
  --axioms propext,Trusted.evidence --axiom-policy policy.json
```

In the SDK, pass the same map as `axioms`; `standardAxioms` holds the standard
ones.

## Tool locations

The command-line tool finds its native checker `zklean-native`, lean4export,
Lake and the verifier key file in the checkout. These environment variables override them; an override
must point to an existing file:

| Variable           | Default                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `ZKLEAN_NATIVE`    | `target/release/zklean-native`                                                                   |
| `ZKLEAN_GUEST_ELF` | `crates/guest/target/elf-compilation/riscv64im-succinct-zkvm-elf/release/zklean-guest`, if built |
| `ZKLEAN_EXPORTER`  | `.tooling/lean4export/.lake/build/bin/lean4export`                                               |
| `ZKLEAN_LAKE`      | `lake` from Lean's installer, elan, or `PATH`                                                    |
| `ZKLEAN_PROFILE`   | `src/guest.json`                                                                                 |

`SP1_GROTH16_CIRCUIT_PATH` moves SP1's proving files from `~/.sp1/circuits`.
