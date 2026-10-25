# Certify and reuse Lean statements

A Lean proof establishes a statement under explicit assumptions, called axioms.
ZKLean checks the proof with [Nanoda](https://github.com/ammkrn/nanoda_lib) inside
[SP1](https://github.com/succinctlabs/sp1/tree/v5.2.4) and produces a certificate:
the identities of the proved claims and the axioms they use, a 260-byte Groth16
proof, and the URL of the Lean export behind them. Run the CLI from a source
checkout as `bun src/cli.ts`; [CONTRIBUTING.md](../CONTRIBUTING.md) lists the tools.

## Check and certify a module

```sh
zklean check --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext
zklean prove --project examples/lean --module V1 \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://acme.example/reservation.ndjson --out reservation.json
```

`check` runs Nanoda and prints the statement: the identities of the claims and
of every axiom the proofs use. `prove` also runs the checker inside SP1, which
takes tens of minutes to hours and several GB of memory, and writes
`reservation.json` and `reservation.ndjson`, the export it proved from.

Publish the export at the `--source` URL. It holds every definition and
statement recipients need, and also your proofs. To keep them private, publish
instead the export of a module that states the claims as `axiom`s
(`zklean export --project … --module Spec --claims … --out reservation.ndjson`);
its identities are the same.

## Verify a certificate

```sh
zklean verify --certificate reservation.json --axioms propext
```

From TypeScript, with [Bun](https://bun.sh/) 1.4.4 or newer:

```ts
import { createVerifier, standardAxioms } from "zklean";

const result = await createVerifier().verify(
  await Bun.file("reservation.json").json(),
  { axioms: { propext: standardAxioms.propext } },
);
if (result.status !== "verified") throw new Error(result.reason);
```

Verification is built in: it needs no native code, Lean or circuit files, and
runs in a background worker off the event loop. The trusted key is
configuration, never certificate data.

## Read a certificate's definitions

An identity hashes a declaration with everything it depends on: every constant
name, type and definition body, but not binder names. Fetch the source export:

```sh
zklean fetch --certificate reservation.json --axioms propext --out reservation.ndjson
```

`fetch` verifies the certificate, downloads its source, checks it with Nanoda
and recomputes every identity, and saves the file only if all of them match.
`--from FILE` checks a local copy instead. Nothing fetched is executed.

An export holds kernel terms rather than readable Lean. To read the definitions
and write your own proofs, use the provider's Lean source from any copy: if its
identities match the certificate, it is the certified model.

## Depend on a certified guarantee

Write your proofs against the provider's Lean module, then record which of its
claims they assume:

```sh
zklean requirements --project client --module Remote \
  --claims Inventory.reservation_safe --out requirements.json
```

A certificate satisfies the snapshot when every required claim appears in it
with the same identity. To use a weaker property, derive it in your own proof and
still require the provider's claim. Regenerate the snapshot whenever its Lean
sources change.

## Choose axioms

`--axioms` permits only the named axioms. Lean's standard axioms (`propext`,
`Quot.sound`, `Classical.choice`) resolve to identities pinned to the toolchain;
any other needs an identity in an `--axiom-policy` file, a JSON object mapping
names to identities, reviewed independently of the certificate's producer. SDK
consumers pass the same map as `axioms`; `standardAxioms` holds the pinned ones.

## Tools

The CLI finds `zklean-native`, the guest ELF, lean4export, Lake and the verifier
profile in the source tree. `ZKLEAN_NATIVE`, `ZKLEAN_GUEST_ELF`,
`ZKLEAN_EXPORTER`, `ZKLEAN_LAKE` and `ZKLEAN_PROFILE` override them; an override
must exist. `SP1_GROTH16_CIRCUIT_PATH` locates the proving circuits.
