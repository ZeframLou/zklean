# Certify and reuse Lean statements

A Lean proof establishes a mathematical statement under explicit assumptions,
called axioms. ZKLean checks that proof with [Nanoda](https://github.com/ammkrn/nanoda_lib)
inside [SP1](https://github.com/succinctlabs/sp1/tree/v5.2.4) and produces a
Groth16 certificate that recipients can verify without the original proof terms.
The certificate names each proposition, definition and used axiom by a content
identity, so it stays a few hundred bytes however large the proofs are.

## Check and certify a module

The installed CLI supplies the checker, prover, exporter, and pinned
[Lean](https://lean-lang.org/) toolchain. Point it at a Lake project that uses
that toolchain. These steps copy the inventory example project shipped with the release:

```sh
cp -R examples/inventory inventory
zklean check --project inventory --module V1 \
  --claims Inventory.reservation_safe \
  --definitions Inventory.POST_reservations --axioms propext
zklean prove --project inventory --module V1 \
  --claims Inventory.reservation_safe \
  --definitions Inventory.POST_reservations --axioms propext \
  --out reservation.json
zklean verify --certificate reservation.json --axioms propext
```

`check` runs Nanoda directly and prints the statement: the identities of the
claims, of the listed definitions, and of every axiom the proofs use.
`--definitions` names declarations the claims are about, such as an API
operation, so recipients can match them too. `prove` additionally runs the checker inside SP1
and generates cryptographic evidence; this can take hours and needs a measured
memory budget. See [Benchmarks](BENCHMARKS.md) before choosing a proving workload;
`prove --timeout MS` overrides the default one-hour deadline. `verify` uses the embedded WebAssembly verifier and the
locally trusted checker key. The npm package is currently unpublished. After publication, recipients can
install the SDK when they do not need source checking or proof generation:

```sh
npm install zklean
```

```ts
import { createVerifier, standardAxioms } from "zklean";

const result = await createVerifier().verify(
  await Bun.file("reservation.json").json(),
  { axioms: { propext: standardAxioms.propext } },
);
if (result.status !== "verified") throw new Error(result.reason);
```

The SDK runs on [Bun](https://bun.sh/) 1.4.4 or newer. It includes its verifier;
it needs no native installation, compiler, Lean process, or circuit download.
Its trusted key is application configuration, never certificate data. Pairing
checks run one at a time in a background worker, outside the application event
loop; an idle worker lets the process exit.
For TypeScript checking in a Bun application, add `@types/bun` as a development
dependency if the project does not already include it.

## Match a certificate against your own requirements

An identity hashes a declaration together with everything it depends on: every
constant name, type and definition body. Binder names are ignored. Two
declarations have the same identity only if they say the same thing about the
same definitions.

To depend on a certified guarantee, compile the provider's Lean specification,
the module that defines the operations and states the claims. It may state
claims as `axiom`s, since a proposition's identity ignores its proof. Then record
what your own code assumes:

```sh
zklean requirements --project client --module Remote \
  --claims Inventory.reservation_safe \
  --definitions Inventory.POST_reservations --out requirements.json
```

A certificate satisfies the snapshot when every required claim and definition
appears in it with the same identity. Requirements generation does not prove the
claims. Regenerate and review the snapshot whenever its Lean sources change, for
example as a CI step.

## Derive a different requirement

A client needing only stock conservation can derive a weaker statement from the
certified guarantee. Save this as `client/Bridge.lean`:

```lean
import Remote

theorem Client.stock_conserved (available requested remaining : Nat) :
    Inventory.POST_reservations available requested = some remaining →
      remaining + requested = available := by
  intro accepted
  exact (Inventory.reservation_safe available requested remaining accepted).2.2
```

Save the remote certificate's `claims` object as `remote-claims.json`, and
certify the derivation with the remote guarantee as a permitted axiom:

```sh
zklean prove --project client --module Bridge \
  --claims Client.stock_conserved \
  --axioms propext,Inventory.reservation_safe \
  --axiom-policy remote-claims.json --out bridge.json
```

The bridge certificate lists `Inventory.reservation_safe` among its axioms with
the remote claim's identity. A recipient verifies both certificates and accepts
the bridge only with that remote claim permitted by identity.

## Choose axioms

`--axioms` permits only the named assumptions the proof actually uses. Lean's
standard axioms (`propext`, `Quot.sound`, `Classical.choice`) resolve to
identities pinned to the toolchain. Any other axiom needs an identity in an
`--axiom-policy` file, a JSON object mapping names to identities, reviewed
independently of an untrusted producer.

SDK consumers pass the policy as `axioms`, a map from name to identity;
`standardAxioms` holds the pinned standard ones. Policy is checked on every call,
including calls answered from the cache.

## Troubleshoot installation

Tools are found next to the installed CLI. Development overrides are
`ZKLEAN_NATIVE`, `ZKLEAN_GUEST_ELF`, `ZKLEAN_EXPORTER`, `ZKLEAN_LAKE`, and
`ZKLEAN_PROFILE`, or the corresponding CLI flags shown by `zklean --help`.
Explicit flag and environment paths must exist; a missing override fails rather
than selecting another tool or verifier profile. Discovery applies only when
no override is supplied.
Profiles must use `zklean/verifier-profile/1` and SP1 `5.2.4`; unsupported versions,
unknown fields, malformed keys/digests, and invalid timeout values are rejected.
Proving uses the checksum-pinned upstream circuit files installed with the CLI;
`SP1_GROTH16_CIRCUIT_PATH` overrides their root for source builds.

See [Development](DEVELOPMENT.md), [Encoding](ENCODING.md), and
[Distribution](DISTRIBUTION.md) for contributor details.
