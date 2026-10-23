# HTTPV

HTTPV is an HTTP protocol and TypeScript library for discovering the formal
specifications advertised by APIs, checking compatibility with a client's
requirements, and monitoring changes.

ZKLean handles certificate generation and local verification independently.
HTTPV consumes the certificate format with an application-supplied verifier;
it does not invoke the ZKLean CLI or generate proofs. Its public API is
[src/index.ts](../src/index.ts); ZKLean's standalone API is
[src/zklean.ts](../src/zklean.ts).

## Inventory example

A checkout client requires reservations to be fully backed by available stock.
The [Lean model](../examples/lean/Inventory.lean) describes an atomic reservation
for one product; the [HTTP handler](../examples/inventory.ts) starts with ten
units and returns the reserved quantity and remaining stock.

The [upgrade demonstration](../examples/upgrades.ts) serves three versions:

- **V1:** Successful reservations are positive, fit in stock, and conserve units.
- **V2:** Preserves V1 and additionally proves that every valid request succeeds.
- **V3:** Accepts backorders. Its certificate is valid, but its guarantees no
  longer establish the checkout client's stock requirement.

The client checks the current advertisement before sending a reservation. It
continues through V2 and blocks requests after V3. A separate Lean derivation
also demonstrates checking a client requirement with a different theorem name.

After the [source setup](DEVELOPMENT.md), generate certificates and run the demo:

```sh
bun scripts/prove-examples.ts
bun run example
```

## Client and server responsibilities

Servers advertise certificates for individual routes and methods through
`OPTIONS` requests with `Accept: application/httpv+json`. Normal application
requests pass through the existing handler.

Clients supply a trusted verifier, permitted axioms, and local requirements.
They verify the cryptographic evidence before comparing the full formal models
or verifying a Lean derivation of compatibility. A valid certificate alone does
not establish that it satisfies the client's requirements.

Clients choose their refresh interval and failure policy. A check returns
`verified`, `incompatible`, or `unknown`; applications can block requests,
switch providers, or notify an operator when verification cannot be established.

HTTPV does not verify deployed code or individual responses. Clients still trust
providers to implement the specifications they advertise.

See [SPEC.md](../SPEC.md) for the discovery, client, and server APIs, and
[Encoding](ENCODING.md) for verifier configuration and compatibility rules.
