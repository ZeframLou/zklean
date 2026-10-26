# Using ZKLean

Only verifying certificates? Run `bun add zklean@0.1.0` and skip to
[Verify a certificate](#verify-a-certificate).

This guide is for **authors**, who publish certificates of their Lean proofs,
and **recipients**, who verify them, read what they claim, or build their own
proofs on top. A certificate names each proved theorem, or **claim**, by its
**identity**: a fingerprint of its statement and of every definition it depends
on. It also lists the **axioms**, unproved assumptions, that the proofs rely
on.

## Set up

Making certificates uses the command-line tool, which runs from a release
checkout. The full tool needs [Bun](https://bun.sh/) 1.4.4 or
newer, stable [Rust](https://rustup.rs/), and
[Lean](https://lean-lang.org/install/) 4.35.0 with its build tool Lake. Your
Lean project, and any project it depends on, must use the same version: its
`lean-toolchain` file must select `leanprover/lean4:v4.35.0`.

```sh
git clone --branch v0.1.0 https://github.com/ZeframLou/zklean.git
cd zklean
bun install --frozen-lockfile
bash scripts/setup-exporter.sh   # builds lean4export, which writes Lean declarations to a file
cargo build --release --locked -p zklean-native   # the native Nanoda checker the tool runs
alias zklean="bun $PWD/src/cli.ts"
```

This guide writes the tool as `zklean`, as the alias above defines it.

Proving needs two more things. First, a native build that includes SP1's
prover; compiling it needs Go 1.24, `protoc` and a C compiler. Second, the
release's **guest**, `zklean-guest`: the compiled checker program that SP1 runs
and proves.

```sh
GOFLAGS=-buildvcs=false cargo build --release --locked -p zklean-native --features prover,execute
curl -fLO https://github.com/ZeframLou/zklean/releases/download/v0.1.0/zklean-guest
export ZKLEAN_GUEST_ELF="$PWD/zklean-guest"
```

The first proof downloads SP1's proving files, a 6.2 GB download that takes
7.8 GB on disk, to `~/.sp1/circuits/groth16`.

Not every command needs all of this:

| Command                 | Needs                                                   |
| ----------------------- | ------------------------------------------------------- |
| `verify`                | the checkout and `bun install`                          |
| `fetch`                 | also the native build, `zklean-native`                  |
| `check`, `requirements` | also Lean and lean4export, unless given `--export FILE` |
| `export`                | also Lean and lean4export                               |
| `prove`, `pin`          | also the prover build and the guest                     |

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
size of the export, and `--timeout MS` raises the one-hour default limit.
`prove` writes the certificate, `reservation.json`, and beside it the
**export** it proved from, `reservation.ndjson`: the file of Lean definitions
the identities are computed from. `check`, `requirements` and `fetch` stop
their native check after 10 minutes.

Publish the export at the `--source` URL, so recipients can confirm your claims
against your Lean source. Serve it over https at exactly that address, without
a redirect, since `fetch` refuses redirects: `raw.githubusercontent.com` links
work, but GitHub release download links redirect.

## Verify a certificate

A verified certificate proves only its own claims. A certificate for some
other theorem under the same name verifies too, so always check that it proves
the claims you rely on, with the identities you expect: the ones `check` printed
for the author's code, or your [requirements](#depend-on-a-certified-claim).

From TypeScript:

```ts
import { createVerifier, standardAxioms } from "zklean";

// The identity `zklean check` printed for the author's code.
const expected =
  "65dea06fd9454a0dc98075d1d9c1c3aff55e0e74b0272c12757dd25c378c8b2f";

const certificate = await Bun.file("reservation.json").json();
const result = await createVerifier().verify(certificate, {
  axioms: { propext: standardAxioms.propext },
});
if (
  result.status !== "verified" ||
  certificate.claims["Inventory.reservation_safe"] !== expected
)
  throw new Error("the certificate does not prove the expected claim");
```

From the command line:

```sh
zklean verify --certificate reservation.json --axioms propext
```

It prints the result and exits with status 1 unless the certificate verifies.
For a verified certificate it also prints the claims and axioms that were
proved. `statementId` is the hash of those claims and axioms, defined in
[ENCODING.md](ENCODING.md#statement-and-certificate). A malformed certificate
prints an error instead.

```json
{
  "statementId": "…",
  "status": "verified",
  "reason": "valid",
  "claims": { "Inventory.reservation_safe": "65dea06f…8b2f" },
  "axioms": { "propext": "a6bbf25b…4158" }
}
```

Anything but `"status": "verified"` means the certificate establishes nothing:
`status` is then `"unknown"` and `reason` is `invalid-certificate`,
`forbidden-axiom`, `axiom-mismatch` or `verifier-unavailable`, with an
optional `detail`.

Verification needs no native code, Lean or network access, and runs in a
background worker so it does not block your program. It checks the
cryptographic proof against the verifier key built into ZKLean, never a key
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
claim and every non-standard axiom. Otherwise it reports the mismatched
identities or the missing declaration and exits with status 1. `--from FILE` checks a local copy instead. A download must finish within 10
minutes and be at most 1 GiB. Nothing fetched is
executed.

An export holds Lean's compiled form of the declarations rather than readable
source. To read the definitions, or to write proofs that use them, get the
author's Lean source from anywhere, then confirm it is the certified model:
export its claims and their dependencies, then check that export against the
certificate:

```sh
# author is your copy of the author's Lean project.
zklean export --project author --module V1 \
  --claims Inventory.reservation_safe --out local.ndjson
zklean fetch --certificate reservation.json --axioms propext \
  --from local.ndjson --out checked.ndjson
```

Without `--claims`, `export` writes the whole module with all of Lean's
standard library, hundreds of megabytes.

## Depend on a certified claim

Your own proofs can assume another project's claims. **Requirements** record
which claims you rely on, by name and identity, so you can later confirm that a
certificate still proves them. First make your Lean project depend on the
author's, in your `lakefile.toml`:

```toml
[[require]]
name = "author"
git = "https://example.com/author.git"
rev = "v1"
```

Then write your proofs against the author's module, and generate your
requirements:

```sh
# client and Remote stand for your own project and the module importing the author's code.
zklean requirements --project client --module Remote \
  --claims Inventory.reservation_safe --out requirements.json
```

A certificate satisfies your requirements when every required claim appears
among its claims with the same identity. The check is in the SDK only, and
applies to a certificate you have verified:

```ts
import {
  createVerifier,
  loadRequirements,
  satisfies,
  standardAxioms,
} from "zklean";

const certificate = await Bun.file("reservation.json").json();
const result = await createVerifier().verify(certificate, {
  axioms: { propext: standardAxioms.propext },
});
if (
  result.status !== "verified" ||
  !satisfies(certificate, await loadRequirements("requirements.json"))
)
  throw new Error("the certificate no longer proves a required claim");
```

To rely on a weaker property, prove it from the author's claim in your own
module, and require the author's claim rather than your derived one: a
certificate lists only the author's claims, so a requirement on your own
theorem could never be satisfied. Regenerate the requirements
whenever the Lean code they come from changes.

## Choose axioms

A certificate is only as good as the axioms it assumes: an axiom can state
something false, and then every claim that uses it is meaningless. So
verification accepts only axioms you name. Lean's standard axioms, `propext`,
`Quot.sound` and `Classical.choice`, resolve to identities pinned to Lean
4.35.0. Any other axiom needs its name in `--axioms` and its identity in an
`--axiom-policy` file, a JSON object mapping axiom names to identities.

Review an axiom in your own copy of the Lean code that declares it, never only
in the author's export. Running `zklean check` there without permitting it
prints its identity:

```text
the proofs use axioms that are not permitted:
  Trusted.evidence dc1a548e17ef5ea0d6890b8bf5fc859a6cfc5caf002e01613f08548802b245b9
  Trusted.stock_policy 2e6eaa4de17f3b133069663f1ef9b9d534492cb37ba9b1462f5cbe5e1f647ce1
```

[`examples/lean/Axioms.lean`](../examples/lean/Axioms.lean) declares these two,
and its theorem `Inventory.assumed_safe` uses them. After reviewing them, write
`policy.json`:

```json
{
  "Trusted.evidence": "dc1a548e17ef5ea0d6890b8bf5fc859a6cfc5caf002e01613f08548802b245b9",
  "Trusted.stock_policy": "2e6eaa4de17f3b133069663f1ef9b9d534492cb37ba9b1462f5cbe5e1f647ce1"
}
```

Then permit them, for example when verifying `assumed.json`, a certificate of
`Inventory.assumed_safe`:

```sh
zklean verify --certificate assumed.json \
  --axioms Trusted.evidence,Trusted.stock_policy --axiom-policy policy.json
```

In the SDK, pass the same map as `axioms`; `standardAxioms` holds the standard
ones.

## Tool locations

The command-line tool finds its native checker `zklean-native`, lean4export,
Lake and the verifier key file in the checkout. These environment variables
override them; an override must point to an existing file:

| Variable           | Default                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `ZKLEAN_NATIVE`    | `target/release/zklean-native`                                                                   |
| `ZKLEAN_GUEST_ELF` | `crates/guest/target/elf-compilation/riscv64im-succinct-zkvm-elf/release/zklean-guest`, if built |
| `ZKLEAN_EXPORTER`  | `.tooling/lean4export/.lake/build/bin/lean4export`                                               |
| `ZKLEAN_LAKE`      | `$ELAN_HOME/bin/lake` (by default `~/.elan/bin/lake`), then `lake` on `PATH`                     |
| `ZKLEAN_PROFILE`   | `src/guest.json`                                                                                 |

`ZKLEAN_PROFILE` sets the verifier key that `verify` and `fetch` trust: override
it only with a **verifier profile** (the verifier key and the guest's SHA-256,
as in `src/guest.json`) you derived yourself, with `zklean pin --out FILE`, from
a guest you built (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
`SP1_GROTH16_CIRCUIT_PATH` moves SP1's proving files from
`~/.sp1/circuits/groth16`.
