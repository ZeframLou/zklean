# ZKLean

Proved something about your code in [Lean](https://lean-lang.org/), a language
for machine-checked proofs? ZKLean ships it as a 1 KB certificate that anyone
can check in under a second, without installing Lean.

## Why

Say you run an inventory service, and you have proved in Lean that a
reservation never takes more stock than you have. The team building checkout on
top of you would love to rely on that. Today they either take your word for it
or rebuild your Lean project on every release. Most take your word for it.

With ZKLean, you publish a certificate with each release, and their CI checks it
in a quarter of a second. If a release changes anything the proof depends on,
their CI goes red before they ship against it.

The certificate covers your Lean model of the service, and you keep that model
faithful to the code.

## What you get

- **Small certificates.** About 1 KB, however long the proofs are.
- **Cheap checking.** Under a second, in TypeScript, with no Lean and no
  network.
- **Precise claims.** Each claim is pinned to the exact statement and
  definitions you proved, so a changed definition can't slip through under the
  same name.
- **An independent checker.** Proofs are re-checked by a Lean checker built
  separately from Lean itself.
- **Explicit assumptions.** A certificate lists every axiom (unproved
  assumption) its proofs rely on, and you choose which ones you accept.

## Try it

Verify the real certificate in this repository, from a clone:

```sh
git clone https://github.com/ZeframLou/zklean.git && cd zklean
bun install
bun src/cli.ts verify --certificate tests/fixtures/identity.certificate.json
```

It prints `"status": "verified"` and the claim it proves.

## Example

[`examples/lean/Inventory.lean`](examples/lean/Inventory.lean) models the
reservation endpoint, and [`V1.lean`](examples/lean/V1.lean) proves that a
successful reservation is positive, fits in stock, and conserves units:

```lean
def POST_reservations (available requested : Nat) : Option Nat :=
  if 0 < requested ∧ requested ≤ available then
    some (available - requested)
  else
    none

theorem reservation_safe (available requested remaining : Nat) :
    POST_reservations available requested = some remaining →
      0 < requested ∧ requested ≤ available ∧ remaining + requested = available
```

The author generates the certificate with the `zklean` command-line tool.
`--axioms propext` accepts the one standard Lean assumption this proof relies
on.

```sh
zklean prove --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://example.com/reservation.ndjson --out reservation.json
```

This takes about 5 to 15 minutes. It writes the certificate and a file of the
Lean definitions behind it, which you publish at the `--source` URL.

Anyone can then check it:

```ts
import { createVerifier, standardAxioms } from "zklean";

const certificate = await Bun.file("reservation.json").json();
const result = await createVerifier().verify(certificate, {
  axioms: { propext: standardAxioms.propext },
});
```

Passing means the listed claims hold. Compare them with the claims you depend
on, as the [usage guide](docs/USAGE.md#verify-a-certificate) shows.

## Install

To verify certificates, on [Bun](https://bun.sh/) 1.4.4 or newer:

```sh
bun add zklean@0.1.0
```

To make certificates, you also need Lean, Rust and a 6 GB prover download; the
[usage guide](docs/USAGE.md#set-up) walks through it.

## Trust model

You trust that the checker, [Nanoda](https://github.com/ammkrn/nanoda_lib) plus
ZKLean's code that fingerprints claims, is correct, that the proof system,
[SP1](https://github.com/succinctlabs/sp1), is sound, and that the verifier key
in the library identifies that checker. A passing certificate means its claims
follow from the axioms you allowed. It does not mean your running code matches
the Lean model, or that the claims say what you need.

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
