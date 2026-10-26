# ZKLean

ZKLean turns a checked Lean proof into a certificate of under 1 KB that anyone
can verify in under a second, without the proof, without installing Lean, and
without trusting whoever made it.

## Why

A formal proof about software is strong evidence, but hard to share. To rely
on someone else's proof today, you download their project, install the same
Lean version and re-run the checker, which can take minutes and gigabytes. You
also need the proof itself, which its author may want to keep private.

With ZKLean, the author proves once and publishes a small certificate. Anyone,
including a program, can then check it offline. For example,
[HTTPV](https://github.com/ZeframLou/httpv) uses ZKLean so that API clients can
check, before relying on an API, that it still guarantees the behaviour their
code depends on.

## Concepts

- **[Lean](https://lean-lang.org/)** is a programming language and proof
  assistant. You model software as Lean definitions, state properties of the
  model as **theorems**, and prove them. Lean checks every step mechanically.
- **Axioms** are statements a proof assumes without proving. Lean's standard
  library relies on three: `propext`, `Quot.sound` and `Classical.choice`. A
  proof can also add its own. Whoever relies on a proof decides which axioms
  they accept.
- An **identity** is a hash of a declaration's name and meaning together with
  everything it depends on. Two theorems with the same identity state the same
  thing about the same definitions. Changing any definition a theorem mentions
  changes its identity.
- A **certificate** lists the proved theorems, called **claims**, and the
  axioms they use, each by name and identity. It carries a cryptographic proof
  that an independent Lean checker accepted the proofs, and links to a file
  holding the definitions behind the identities, so readers can see what the
  claims mean.
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
                                                 3. optionally fetch the definitions
                                                    and confirm their identities
```

Proving takes about 5 to 15 minutes and up to 20 GB of memory on a 12-core
machine, once per version of the proofs. Verifying needs no Lean, native code
or network access. The inventory example below has a 381 KB Lean export but a
certificate under 1 KB.

## Trust model

A verifier trusts that Nanoda checks Lean correctly, that SP1's proofs are
sound, and that the SDK's built-in **verifier key**, a fingerprint of the exact
checker program, is the right one. A verified certificate shows that each claim
follows from the axioms it lists. Whether the claims say what you need is for
you to judge by reading them.

## Install

The TypeScript SDK verifies certificates. It runs on [Bun](https://bun.sh/)
1.4.4 or newer:

```sh
bun add zklean@0.1.0
```

The command-line tool checks and proves Lean modules. It runs from a release
checkout, set up as in the [usage guide](docs/USAGE.md#set-up).

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

In a checkout, check the proof and see the claim's identity and the axioms it
uses:

```sh
bun src/cli.ts check --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext
```

Then prove it and verify the certificate. `--source` is the URL where you will
publish the definitions file that `prove` writes beside the certificate:

```sh
bun src/cli.ts prove --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://example.com/reservation.ndjson --out reservation.json
bun src/cli.ts verify --certificate reservation.json --axioms propext
```

`--axioms propext` accepts the one standard axiom this proof uses. A
certificate that uses any other axiom fails verification.

The [usage guide](docs/USAGE.md) covers verifying from TypeScript, publishing
definitions, depending on another project's claims, and choosing axioms. The
[certificate specification](SPEC.md) and [encoding](docs/ENCODING.md) define
the formats; [CONTRIBUTING.md](CONTRIBUTING.md) covers development.

## License

[MIT NON-AI License](LICENSE). The vendored Nanoda checker keeps its own
[Apache 2.0 license](vendor/nanoda/LICENSE).
