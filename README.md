# ZKLean

Ship proofs about your software that anyone can check in under a second,
without installing Lean and without trusting you.

ZKLean turns a proof written in [Lean](https://lean-lang.org/), a language for
machine-checked proofs, into a certificate of about 1 KB. Anyone can verify the
certificate with a small TypeScript library.

## Why

Say you run an inventory service, and you have proved in Lean that a
reservation never takes more stock than you have. A team building checkout on
top of you would love to rely on that. Today they have two options: take your
word for it, or clone your project, install your exact Lean version and re-run
your proofs on every release. Most take your word for it.

With ZKLean, you publish a 1 KB certificate with each release, and their CI
checks it in a quarter of a second. The certificate names exactly what you
proved, down to every definition the theorem mentions. If a release changes
any of them, the certificate changes too, and their check fails before they
ship against it.

[HTTPV](https://github.com/ZeframLou/httpv) builds on this, so that API clients
can check an API's promises before every request.

## What you get

- **Small certificates.** About 1 KB, however long the proofs are.
- **Cheap checking.** Under a second in TypeScript, with no Lean, native code
  or network access.
- **Exact claims.** Each proved theorem is named by its **identity**, a
  fingerprint of its statement and of every definition it depends on. Same
  identity, same meaning.
- **An independent checker.** Proofs are re-checked by
  [Nanoda](https://github.com/ammkrn/nanoda_lib), a Lean checker written
  separately from Lean itself, running inside
  [SP1](https://github.com/succinctlabs/sp1), which produces the short
  cryptographic proof that the check passed.
- **Explicit assumptions.** Proofs can rest on **axioms**, statements assumed
  without proof. A certificate lists every axiom its proofs use, and you choose
  which ones you accept.

## Example

[`examples/lean/Inventory.lean`](examples/lean/Inventory.lean) models the
reservation endpoint:

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

The author checks the proof, then generates the certificate. `--axioms propext`
allows the one standard Lean axiom this proof uses.

```sh
zklean check --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext
zklean prove --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://example.com/reservation.ndjson --out reservation.json
```

Proving takes about 5 to 15 minutes for this example. It writes
`reservation.json`, the certificate, and `reservation.ndjson`, the Lean
definitions behind it, which you publish at the `--source` URL.

Anyone can then verify the certificate:

```ts
import { createVerifier, standardAxioms } from "zklean";

const certificate = await Bun.file("reservation.json").json();
const result = await createVerifier().verify(certificate, {
  axioms: { propext: standardAxioms.propext },
});
```

A verified certificate proves exactly the claims it lists. Check that they are
the ones you rely on, with the identities you expect; the
[usage guide](docs/USAGE.md#verify-a-certificate) shows how.

## Trust model

You trust that the checker, Nanoda plus ZKLean's identity code, is correct, that
SP1's proof system is sound, and that the verifier key in the library
identifies that checker. A passing certificate means its claims follow from the
axioms you allowed. It does not mean your running code matches the Lean model,
or that the claims say what you need.

## Install

```sh
bun add zklean@0.1.0
```

That is all verifying needs, on [Bun](https://bun.sh/) 1.4.4 or newer. Checking
and proving use the command-line tool from a release checkout; the
[usage guide](docs/USAGE.md#set-up) sets it up. The
[specification](SPEC.md) and [encoding](docs/ENCODING.md) define the formats,
and [CONTRIBUTING.md](CONTRIBUTING.md) covers development.

## License

[MIT NON-AI License](LICENSE). The vendored Nanoda checker keeps its own
[Apache 2.0 license](vendor/nanoda/LICENSE).
