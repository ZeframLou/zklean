# ZKLean

**Formal verification for interconnected software**

ZKLean turns a formal proof about your code, written in
[Lean](https://lean-lang.org/) (a language for machine-checked proofs), into a
1 KB certificate. Anyone can check it in under a second, without installing
Lean.

ZKLean makes formal verification practical for software with third-party
dependencies, be it packages or API endpoints.

## Why

Say you run the inventory service for an online shop, and you have proved in
Lean that a reservation never takes more stock than you have. The team building
checkout on top of you would love to rely on that, and they'd want to make sure
you didn't add a bug or a backorder feature in a new release.

Today they either take your word for it or rebuild your Lean project and wait
out its full proof check, on every release. This is extremely expensive: Lean
proofs could easily be thousands of lines long, and for production software they
could be 10k-100k+ lines.

With ZKLean, you publish a certificate with each release, which includes a
succinct zero-knowledge proof (356 bytes) that can be checked in under a second.
The ZK proof shows that _some_ valid proof exists for your Lean specs, without
needing the actual proofs.

This way, other people can depend on your software and build their own formal
specs that depend on your specs.

## What you get

- **Small certificates.** About 1 KB, however long the proofs are.
- **Cheap checking.** Under a second, in TypeScript, with no Lean and no
  network.
- **Precise claims.** Each claim is fingerprinted with its exact statement and
  definitions, so renaming can't hide a change.
- **Explicit assumptions.** A certificate lists every axiom (unproved
  assumption) its proofs rely on, and you choose which ones you accept.

## Install

To verify certificates, on [Bun](https://bun.sh/) 1.4.4 or newer:

```sh
bun add zklean@0.1.0
```

To make certificates, you also need Lean, Rust, a 6 GB prover download and
about 20 GB of memory; the [usage guide](docs/USAGE.md#set-up) walks through it.

## Try it

This repository has a real certificate for the example below. Verify it from a
clone:

```sh
git clone https://github.com/ZeframLou/zklean.git && cd zklean
bun install
bun src/cli.ts verify --certificate tests/fixtures/percent.certificate.json --axioms propext
```

It prints `"status": "verified"` and the claim it proves,
`Progress.percent_le_100`.

## Example

A progress bar never shows more than 100%.
[`examples/lean/Percent.lean`](examples/lean/Percent.lean) defines how progress
becomes a percentage, rounding down and showing 0% for an empty task, and proves
the result never goes above 100% when the work done doesn't exceed the total:

```lean
def percent (done total : Nat) : Nat :=
  if total = 0 then 0 else done * 100 / total

theorem percent_le_100 (done total : Nat) (h : done ≤ total) :
    percent done total ≤ 100
```

Generate the certificate with the `zklean` CLI
([setup](docs/USAGE.md#set-up)). `--axioms propext` accepts the one standard
Lean assumption this proof relies on.

```sh
zklean prove --project examples/lean --module Percent \
  --claims Progress.percent_le_100 --axioms propext \
  --source https://example.com/percent.ndjson --out percent.json
```

This takes about 5 to 20 minutes. It writes the certificate and a file of the
Lean definitions behind it, which you publish at the `--source` URL.

Anyone can then check it:

```ts
import { createVerifier, standardAxioms } from "zklean";

const certificate = await Bun.file("percent.json").json();
const result = await createVerifier().verify(certificate, {
  axioms: { propext: standardAxioms.propext },
});
```

A pass proves the listed claims; check they include the ones you rely on
([how](docs/USAGE.md#verify-a-certificate)).

## Practical workflow

1. **Prove.** You prove your specs in Lean as usual, then run `zklean prove` to
   produce the certificate: each proved theorem's name and fingerprint, the
   axioms it relies on, and a 356-byte proof that the check passed.
2. **Pin.** Each team that depends on you reviews the theorems it relies on
   once, in Lean, and records their fingerprints with `zklean requirements`. A
   fingerprint covers a theorem's statement and every definition it mentions,
   not its proof.
3. **Verify.** On every release, they verify your new certificate and compare
   fingerprints, in under a second with no Lean. A change to anything the
   theorem depends on changes its fingerprint and fails the check. A change to
   the proofs or to unrelated code passes.

## How it works

```text
author:  Lean module ─▶ lean4export ─▶ export ─▶ SP1 zkVM running the guest ─▶ certificate
anyone:  certificate ─▶ TypeScript SDK (SP1 verifier, pinned key) ─▶ pass or fail
```

- **Export.** Lean compiles your module, and
  [lean4export](https://github.com/leanprover/lean4export) writes every
  declaration it depends on, proofs included, to one file. ZKLean keeps only
  what your claims need, with theorems from Lean's standard library as
  statements without their proofs.
- **Guest.** A Rust program checks that export with
  [Nanoda](https://github.com/ammkrn/nanoda_lib), a Lean type checker written
  independently of Lean. It rejects any redefinition of the 31 built-in
  constants Nanoda evaluates natively, computes each claim's fingerprint from
  its statement and everything that statement mentions, and collects the axioms
  the proofs use. It accepts each standard-library statement by its membership
  in a pinned table of Lean 4.35.0's 41,920 library theorems, and reports the
  axioms their proofs use instead. Its only output is a 32-byte hash of the
  claims and axioms.
- **Prover.** [SP1](https://github.com/succinctlabs/sp1), a zkVM, runs the guest
  and proves it ran correctly: a STARK proof, recursively compressed and wrapped
  into a 356-byte Groth16 proof over BN254. The export is the private input;
  only the 32-byte hash is public.
- **Certificate.** The claims and axioms with their fingerprints, the Groth16
  proof, and the URL where the export is published.
- **Verifier.** The TypeScript SDK recomputes the hash from the certificate's
  claims and axioms and checks the proof with SP1's own verifier, compiled to
  WebAssembly, against a **verifier key** pinned in the SDK. That key identifies
  the exact guest program, so a proof from any other program fails. It runs in a
  background worker and needs no native code, Lean or network.

## Trust model

You trust four things: the checker
([Nanoda](https://github.com/ammkrn/nanoda_lib) plus ZKLean's fingerprinting
code) is correct, Lean's own kernel checked its standard library, the
[SP1](https://github.com/succinctlabs/sp1) proof system is sound, and the
library's verifier key matches that checker. A passing
certificate means its claims follow from the axioms you allowed. It does not
mean your running code matches the Lean model, or that the claims say what you
need.

## More

- The [usage guide](docs/USAGE.md) covers making, verifying and depending on
  certificates.
- The [specification](SPEC.md) and [encoding](docs/ENCODING.md) define the
  formats; [CONTRIBUTING.md](CONTRIBUTING.md) covers development.
- [HTTPV](https://github.com/ZeframLou/httpv) builds on ZKLean so that API
  clients can check an API's promises before every request.

## License

[MIT NON-AI License](LICENSE). The vendored Nanoda checker keeps its own
[Apache 2.0 license](vendor/nanoda/LICENSE).
