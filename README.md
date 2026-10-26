# ZKLean

ZKLean turns a proof checked by Lean, a language for machine-checked proofs,
into a certificate of about 1 KB that anyone can verify in under a second,
without the proof, without installing Lean, and without trusting whoever made
it.

## Why

A formal proof about software is strong evidence, but hard to share. To rely
on someone else's proof today, you download their project, install the same
Lean version and re-run the checker, which can take minutes and gigabytes.

With ZKLean, the author proves once and publishes a small certificate. Anyone,
including a program, can then check it offline. For example,
[HTTPV](https://github.com/ZeframLou/httpv) uses ZKLean so that API clients can
check, before relying on an API, that the API's published Lean model still has
the properties their code depends on.

## Concepts

- **[Lean](https://lean-lang.org/)** is a programming language and proof
  assistant. You model software as Lean definitions, state properties of the
  model as **theorems**, and prove them. Lean checks every step mechanically.
  Lean code is organised in **modules**, one per source file.
- **Axioms** are statements a proof assumes without proving. Lean's standard
  library relies on three: `propext`, `Quot.sound` and `Classical.choice`. A
  proof can also add its own. Whoever relies on a proof decides which axioms
  they accept.
- An **identity** is a hash of a Lean definition's or theorem's name and
  meaning, together with everything it depends on. Two theorems with the same
  identity state the same thing about the same definitions. Changing any
  definition a theorem mentions changes its identity.
- An **export** is a file of a Lean module's definitions and theorems, written
  by Lean's [lean4export](https://github.com/leanprover/lean4export) tool. It is
  what ZKLean checks and computes identities from.
- A **certificate** lists the proved theorems, called **claims**, and the
  axioms they use, each by name and identity. It carries a cryptographic proof
  that an independent Lean checker accepted the proofs, and a link to the export
  behind the identities, so readers can confirm the identities against Lean source.
- The cryptographic proof comes from **[SP1](https://github.com/succinctlabs/sp1)**,
  which runs a program and produces a short proof that the program ran and gave
  a particular result. ZKLean's program checks Lean proofs with
  [Nanoda](https://github.com/ammkrn/nanoda_lib), a Lean checker written
  independently of Lean itself.

## How it works

```text
 author                                         recipient
 ──────                                         ─────────
 Lean module ── zklean prove ──▶ certificate ──▶ 1. verify the cryptographic proof
                 (Nanoda inside SP1)             2. accept only permitted axioms
                                                 3. check the claims are the ones
                                                    relied on, by identity
                                                 4. optionally fetch the export
                                                    and confirm its identities
```

Proving happens once per version of the proofs. For the example below it takes
about 5 to 15 minutes and up to 20 GB of memory on a 12-core machine; larger
exports take longer. Verifying needs no Lean, native code or network access. The inventory example below has a 381 KB export but a
certificate under 1 KB; a certificate grows with its number of claims, not with
the size of the proofs. A certificate never contains your proofs, but the
export `prove` writes does, and the cryptographic proof is not promised to hide
them; see [keeping proofs private](docs/USAGE.md#certify-a-module).

## Trust model

A verifier trusts the checker program, Nanoda plus ZKLean's identity code, to be
correct, and the **verifier key** built into ZKLean's TypeScript library to
identify that program. It also trusts SP1's proofs to be sound, which holds
unless every participant in SP1's one-time trusted setup colluded. A
certificate passes only if every axiom it uses is one you permitted, and then
shows that each claim about the Lean model follows from those axioms; it says
nothing about whether running software matches that model, or whether the
claims say what you need.

## Install

The TypeScript library (SDK) verifies certificates. It runs on [Bun](https://bun.sh/)
1.4.4 or newer:

```sh
bun add zklean@0.1.0
```

The command-line tool checks and proves Lean modules, and verifies and reads
certificates. It runs from a release checkout, set up as in the
[usage guide](docs/USAGE.md#set-up).

## Example: an inventory reservation

[`examples/lean/Inventory.lean`](examples/lean/Inventory.lean) models an
endpoint that reserves stock:

```lean
def POST_reservations (available requested : Nat) : Option Nat :=
  if 0 < requested ∧ requested ≤ available then
    some (available - requested)
  else
    none
```

[`V1.lean`](examples/lean/V1.lean) proves that a successful reservation is
positive, fits in stock, and conserves units:

```lean
theorem reservation_safe (available requested remaining : Nat) :
    POST_reservations available requested = some remaining →
      0 < requested ∧ requested ≤ available ∧ remaining + requested = available
```

After [setting up the command-line tool](docs/USAGE.md#set-up), which defines
`zklean`, check the proof:

```sh
zklean check --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext
```

It prints the statement a certificate would prove: the claim and the one axiom
its proof uses, each with its identity.

```json
{
  "axioms": { "propext": "a6bbf25b…4158" },
  "claims": { "Inventory.reservation_safe": "65dea06f…8b2f" },
  "format": "zklean/1"
}
```

Then prove it and verify the certificate. Proving needs the
[prover build](docs/USAGE.md#set-up) and downloads 6.2 GB of SP1 files on first
use. `--source` is the URL where you will
publish the export that `prove` writes beside the certificate:

```sh
zklean prove --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://example.com/reservation.ndjson --out reservation.json
zklean verify --certificate reservation.json --axioms propext
```

`--axioms propext` accepts the one standard axiom this proof uses. A
certificate that uses any other axiom fails verification. A verified
certificate proves only its own claims, which `verify` prints: check that they
are the claims, with the identities, that you rely on.

The [usage guide](docs/USAGE.md) covers verifying from TypeScript, publishing
exports, keeping proofs private, depending on another project's claims, and
choosing axioms. The
[certificate specification](SPEC.md) and [encoding](docs/ENCODING.md) define
the formats; [CONTRIBUTING.md](CONTRIBUTING.md) covers development.

## License

[MIT NON-AI License](LICENSE). The vendored Nanoda checker keeps its own
[Apache 2.0 license](vendor/nanoda/LICENSE).
