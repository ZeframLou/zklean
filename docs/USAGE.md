# Certify and reuse Lean statements

A Lean proof establishes a mathematical statement under explicit assumptions,
called axioms. ZKLean checks that proof with [Nanoda](https://github.com/ammkrn/nanoda_lib)
inside [SP1](https://github.com/succinctlabs/sp1/tree/v5.2.4) and produces a
Groth16 certificate that recipients can verify without the original proof terms.
The certificate still includes the statement's definitions and any used axioms.

## Create a project

The installed CLI supplies the checker, prover, exporter, and pinned
[Lean](https://lean-lang.org/) toolchain. Start with its inventory example:

```sh
zklean init --project inventory
zklean check --project inventory --module V1 \
  --claims Inventory.reservation_safe --axioms propext
zklean prove --project inventory --module V1 \
  --claims Inventory.reservation_safe --axioms propext --out reservation.json
zklean verify --certificate reservation.json --axioms propext
```

`check` runs Nanoda directly. `prove` additionally runs the checker inside SP1
and generates cryptographic evidence; this can take hours and needs a measured
memory budget. See [Benchmarks](BENCHMARKS.md) before choosing a proving workload;
`prove --timeout MS` overrides the default one-hour deadline. `verify` uses the embedded WebAssembly verifier and the
locally trusted checker key. Recipients install only the npm SDK when they do
not need source checking or proof generation:

```sh
npm install zklean
```

```ts
import { createVerifier } from "zklean";

const result = await createVerifier().verify(
  await Bun.file("reservation.json").json(),
  { allowedAxioms: ["propext"] },
);
if (result.status !== "verified") throw new Error(result.reason);
```

The SDK runs on [Bun](https://bun.sh/) 1.4.4 or newer. It includes its verifier;
it needs no native installation, compiler, Lean process, or circuit download.
Its trusted key is application configuration, never certificate data.

## Read a received certificate

```sh
zklean inspect --certificate reservation.json --axioms propext
zklean import --certificate reservation.json --axioms propext \
  --out inventory/Remote.lean
```

Both commands authenticate the certificate and enforce the axiom policy first.
`inspect` prints its statements and relevant definitions using Lean's printer.
`import` reconstructs kernel objects through Lean's public API and writes an
assumption fingerprint file, `inventory/Remote.lean.axioms.json`.

Review the operations, types, definitions, and assumptions before depending on
them. Matching names alone do not establish that a statement means what your
application needs. Import checks existing Lean declarations against the public
model and rejects collisions; it does not silently replace local definitions.

## Derive a different requirement

The imported guarantee says a successful reservation has a positive quantity,
fits within available stock, and preserves stock. A client needing only stock
conservation can derive a weaker statement. Save this as `inventory/Bridge.lean`:

```lean
import Remote

theorem Client.stock_conserved (available requested remaining : Nat) :
    Inventory.POST_reservations available requested = some remaining →
      remaining + requested = available := by
  intro accepted
  exact (Inventory.reservation_safe available requested remaining accepted).2.2
```

Add `"Remote"` and `"Bridge"` to the `roots` array in `inventory/lakefile.toml`.
Certify the derivation while explicitly permitting the imported assumption:

```sh
zklean prove --project inventory --module Bridge \
  --claims Client.stock_conserved \
  --axioms Inventory.reservation_safe \
  --axiom-policy inventory/Remote.lean.axioms.json --out bridge.json
```

The imported theorem is an axiom for this separate proof. Its fingerprint binds
its full proposition and dependency context; an identically named assumption
with different definitions is rejected. A recipient must independently verify
both the remote certificate and the bridge, match that assumption against the
remote guarantee, and check that the bridge establishes its local requirements.

The ordinary verifier does not establish the imported assumption's truth by
itself. Keep the source certificate and its independently verified bridge
together in the consuming application's compatibility check.

## Preserve local requirements

Generate a snapshot from reviewed local Lean declarations:

```sh
zklean requirements --project inventory --module Bridge \
  --claims Client.stock_conserved --out requirements.json
```

Requirements generation records the propositions you require, without claiming
to prove them. Source manifests bind the resolved Lake sources, including
transitive imports; source changes require a fresh snapshot and review.

Exact matching compares resolved kernel contexts, ignoring bound-variable
display names and binder annotations. It does not infer arbitrary mathematical
equivalence. Changed definitions under the same names require distinct or
versioned contexts in a bridge; rename or namespace those definitions before
combining them in one Lean environment.

## Choose axioms

`--axioms` permits only the named assumptions actually used by the proof. The
standard Lean axioms are pinned to the toolchain; custom axioms additionally
require `--axiom-policy` fingerprints reviewed independently of an untrusted
producer. Import produces candidate pins only after certificate authentication;
review the model before using that output as application policy.

For SDK consumers, pass the same choices as `allowedAxioms` and `axiomPins`.
Policy is checked again on every call, including cached cryptographic results.

## Troubleshoot installation

Run `zklean doctor` to locate bundled tools. Development overrides are
`ZKLEAN_NATIVE`, `ZKLEAN_GUEST_ELF`, `ZKLEAN_EXPORTER`, `ZKLEAN_LAKE`, and
`ZKLEAN_PROFILE`, or the corresponding CLI flags shown by `zklean --help`.
Proving uses the checksum-pinned upstream circuit files installed with the CLI;
`SP1_GROTH16_CIRCUIT_PATH` overrides their root for source builds.

See [Development](DEVELOPMENT.md), [Encoding](ENCODING.md), and
[Distribution](DISTRIBUTION.md) for contributor details.
