# ZKLean & HTTPV
**Internet-Draft**  
**Status:** Experimental

## Abstract

This document specifies two complementary protocols:

- **ZKLean:** Generates succinct cryptographic certificates proving that a set of Lean 4 propositions has been formally derived using an explicit set of axioms.
- **HTTPV (HTTP Verified):** Extends HTTP/HTTPS to let clients discover, verify, and monitor the formal specifications advertised by remote API endpoints.

Together, they enable **compositional formal verification across independently maintained software components**, even when remote dependencies change over time.

## 1. Motivation

Formal verification traditionally assumes that a program's dependencies have known, stable behavior. This assumption breaks down in distributed systems.

A client may be formally verified but depend on third-party REST APIs whose implementations and behavior can change without notice. Such changes can invalidate the assumptions underlying the client's formal guarantees.

Today, clients have no standardized mechanism to obtain machine-verifiable formal specifications from remote dependencies or determine whether those specifications remain compatible with their own proofs.

ZKLean makes formal proofs succinct, portable, and inexpensive to verify.

HTTPV makes remote formal specifications discoverable and continuously checkable, allowing clients to determine whether their own formal guarantees still hold under the specifications currently advertised by their dependencies.

### 1.1. Goals

1. **Succinctness:** Replace large formal proofs with small, inexpensive-to-verify certificates.
2. **Transparency:** Expose exact formal specifications and their trusted axioms.
3. **Composability:** Allow a client's formal proofs to depend on independently verified remote specifications.
4. **Change detection:** Detect changes to the formal models advertised by remote endpoints.
5. **Compatibility verification:** Determine whether updated remote guarantees still satisfy the client's formal assumptions.
6. **Client autonomy:** Let clients decide how to respond to incompatible, missing, or unverifiable remote specifications.
7. **Compatibility:** Integrate with existing HTTP/HTTPS infrastructure without changing normal request semantics.

### 1.2. Security Model

ZKLean cryptographically attests that specified Lean propositions have valid derivations under explicitly declared axioms, subject to the soundness of the trusted proof checker and cryptographic proving system.

HTTPV authenticates, through HTTPS, the certificates currently advertised by a remote endpoint.

Clients trust remote providers to implement and deploy the behavior described by their advertised formal specifications. HTTPV does not independently attest to deployed code or prove that individual responses satisfy those specifications.

A client's formal guarantees remain **conditional on its remote dependencies satisfying the specifications on which the client relies**.

Clients MUST independently validate certificates and enforce their own acceptable-axiom policies.

## 2. Conventions

The terms MUST, MUST NOT, SHOULD, and MAY are interpreted according to RFC 2119 and RFC 8174.

A *specification* is a proposition expressed in Lean 4.

A *certificate* contains a public formal model, explicit axioms, and a succinct cryptographic proof of the specified propositions.

A *remote contract* is the formal model a server advertises for an HTTP endpoint.

A *client requirement* is a proposition about remote behavior that a client's own formal correctness proof assumes.

## 3. ZKLean

### 3.1. Architecture

ZKLean uses three existing components:

- **lean4export:** Exports Lean 4 declarations, proof terms, and dependencies.
- **Nanoda:** Independently verifies exported Lean proof terms.
- **SP1:** Generates succinct cryptographic proofs attesting to successful verification.

```text
Lean specifications + proofs + axioms
                  |
             lean4export
                  |
           Nanoda inside SP1
                  |
          Succinct certificate
```

No custom theorem language, intermediate representation, or proof system is required beyond serialization of Lean's existing kernel expressions.

### 3.2. Certificate Generation

ZKLean accepts public specifications, their proofs, and the permitted axioms.

The SP1 guest MUST:

1. Validate the exported Lean declarations and dependency environment using Nanoda.
2. Check every proof against its corresponding specification.
3. Identify the axioms relied upon by the verified dependency closure.
4. Reject undeclared axioms and invalid dependencies.
5. Cryptographically bind the public formal model and actual axiom list to the SP1 proof.

One succinct certificate covers the entire specification set.

### 3.3. Certificate Format

```json
{
  "format": "zklean/1",
  "specs": {
    "declarations": "base64:...",
    "claims": ["Transfer.transfer_safe"]
  },
  "axioms": ["propext", "Quot.sound"],
  "proof": "base64:..."
}
```

Fields:

- `format`: Certificate format identifier.
- `specs`: Self-contained public Lean formal model.
  - `declarations`: Canonically serialized Lean kernel declarations necessary to interpret the specified propositions, including their types and definitions.
  - `claims`: Names of the propositions whose derivability is certified.
- `axioms`: Exact list of axioms relied upon by the checked proofs.
- `proof`: Succinct SP1 proof.

**The `specs` field MUST contain everything necessary to interpret the formal model**, including the relevant dependency closure of definitions, types, and axiom declarations. It MUST exclude standalone theorem bodies and unrelated declarations. Proof subexpressions inside computational definitions MAY remain when they are part of the exact declaration needed to interpret the model; proof profiles MUST state whether they provide witness privacy.

Lean's built-in semantics are fixed by the trusted proof-checker implementation. The public model MUST NOT rely on unresolved or unauthenticated external definitions.

Clients MUST be able to deserialize `specs` into a well-defined Lean formal model suitable for subsequent compatibility proofs.

All security-relevant values MUST use deterministic, versioned encoding and be cryptographically bound to the proof.

Verification MUST use a trusted, pinned SP1 verifier identity rather than one arbitrarily supplied by a certificate.

The initial implementation SHOULD use SP1's compressed STARK proof format. Groth16 MAY be supported by a separately pinned verifier profile.

### 3.4. Verification API

```typescript
prove(specs, proofs, allowedAxioms): Certificate

verify(
  certificate,
  allowedAxioms
): boolean
```

Verification succeeds only when the SP1 proof is valid, its authenticated public values match the certificate, and all trusted axioms are permitted by the client.

The original Lean proof terms are not required for certificate verification.

Certificates MAY be generated offline and reused indefinitely for the same formally checked statements.

## 4. HTTPV — HTTP Verified

### 4.1. Overview

HTTPV allows clients to retrieve the formal contracts currently advertised by HTTP endpoints.

The primary use case is a formally verified client that relies on remote components whose behavior may evolve independently.

The client proves its own properties under explicit assumptions about remote endpoints. HTTPV provides a mechanism to retrieve and continuously validate the advertised remote guarantees against those assumptions.

HTTPV uses the existing HTTP `OPTIONS` method and requires no changes to ordinary application requests or responses.

### 4.2. Certificate Discovery

A client requests endpoint certificates using:

```http
OPTIONS /transfer HTTP/1.1
Host: example.com
Accept: application/httpv+json
Cache-Control: no-cache
```

A supporting server responds:

```http
HTTP/1.1 200 OK
Content-Type: application/httpv+json
Cache-Control: no-store

{
  "certificates": {
    "POST": {
      "format": "zklean/1",
      "specs": {
        "declarations": "base64:...",
        "claims": ["Transfer.transfer_safe"]
      },
      "axioms": ["propext", "Quot.sound"],
      "proof": "base64:..."
    }
  }
}
```

The `certificates` object maps HTTP methods to their respective ZKLean certificates.

The advertised contract MUST define the behavior of the corresponding HTTP method and resource. This association MUST be authenticated as part of the HTTPV response, and the formal model MUST precisely identify the operations and inputs it describes.

Parameterized routes MAY share a certificate when its model explicitly covers the applicable parameter domain.

The server MUST return the formal contracts it currently advertises for the requested resource.

### 4.3. Compositional Verification

A verified client may depend on guarantees supplied by remote components.

Let:

- \(C\): Client implementation.
- \(S_C\): Desired client correctness specification.
- \(R_i\): Client requirement for remote dependency \(i\).
- \(G_i\): Formally certified guarantees advertised by remote dependency \(i\).

The client's proof establishes:

\[
(R_1 \land \cdots \land R_n)
\implies S_C(C)
\]

For this proof to remain applicable, each remote dependency must advertise guarantees sufficient to establish the corresponding requirement:

\[
G_i \implies R_i
\]

HTTPV MUST support checking this compatibility relationship.

A compatibility check may succeed through an exact match of certified propositions or a separately verified Lean derivation establishing that the advertised guarantees imply the required propositions.

The client's requirement and the remote formal model MUST be interpreted using compatible, explicitly resolved definitions. Identical proposition names alone are insufficient.

**An arbitrary semantic implication MUST NOT be assumed merely because two certificates are valid.** If compatibility cannot be established, the dependency is unverified with respect to the client's requirements.

When a remote certificate changes, the client MAY:

1. Reuse its existing client proof if the new remote guarantees still establish its requirements.
2. Re-run formal verification of the client against the updated remote model.
3. Declare the dependency incompatible and apply application-defined handling.

The client MUST NOT treat a remote model as compatible solely because its ZKLean certificate verifies successfully.

### 4.4. Continuous Verification

Remote HTTP APIs may change their behavior and advertised formal models without notifying clients.

HTTPV clients SHOULD periodically retrieve the current certificates of their remote dependencies.

Each client controls:

- **Refresh interval:** How frequently remote certificates are checked.
- **Required guarantees:** Which propositions must continue to hold.
- **Axiom policy:** Which trusted axioms are acceptable.
- **Failure policy:** What happens when compatibility cannot be established.

The verification process is:

```text
      Client formal proof
              |
      Remote requirements
              |
              v
    Fetch remote certificate
              |
      Verify ZKLean proof
              |
    Check G_remote => R_client
              |
         +----+----+
         |         |
     Compatible  Incompatible
         |         |
    Continue    Client policy
         |
     Recheck later
```

Clients SHOULD compare cryptographic identities of canonical public models before performing more expensive compatibility checks.

If the model is unchanged and the previous compatibility result remains valid under the current policy, the client MAY reuse that result.

When a model changes, the client MUST re-establish compatibility before treating the updated model as satisfying its requirements.

Possible client policies include rejecting requests, disabling dependent functionality, using a fallback provider, notifying an operator, or initiating re-verification.

HTTPV does not mandate any particular policy.

### 4.5. Freshness and Failure Semantics

HTTPV discovery responses MUST describe the server's currently advertised formal contract.

Servers SHOULD return `Cache-Control: no-store`. Clients requiring fresh advertisements MUST avoid reliance on stale cached discovery responses.

Clients MAY cache certificates and previously verified compatibility results by cryptographic identity.

A failed HTTPV check has one of three outcomes:

- **Verified:** The current advertised contract is valid and satisfies the client's requirements.
- **Incompatible:** The advertised contract is valid but does not establish the client's requirements.
- **Unknown:** The certificate is missing, inaccessible, invalid, or compatibility cannot be determined.

Applications decide how to handle each outcome.

Periodic checking cannot guarantee that an advertised contract will remain unchanged between checks. HTTPV also cannot detect a provider changing its actual behavior while continuing to advertise the same certificate. Clients requiring stronger guarantees need separate execution attestation or response-proof mechanisms.

## 5. TypeScript/Bun Implementation

The project MUST provide a TypeScript library targeting Bun, with client and server integration APIs.

### 5.1. Client API

**Query a certificate:**

```typescript
import { HTTPV } from "httpv";

const certificate = await HTTPV.query(
  "https://example.com/transfer",
  { method: "POST" }
);

const result = await HTTPV.verify(certificate, {
  allowedAxioms: ["propext", "Quot.sound"]
});
```

**Check compatibility:**

```typescript
const result = await HTTPV.checkCompatibility({
  certificate,
  requirements: "./specs/remote.lean",
  allowedAxioms: ["propext", "Quot.sound"]
});
```

The compatibility API MUST validate both the remote certificate and a formal derivation that the remote guarantees establish the client's requirements. It MUST fail to establish compatibility if no valid derivation is available.

**Monitor a dependency:**

```typescript
const monitor = HTTPV.watch({
  url: "https://example.com/transfer",
  method: "POST",
  requirements: "./specs/remote.lean",
  interval: 60_000,

  onChange: (result) => {
    if (result.status !== "verified") {
      // Application-defined handling
    }
  }
});
```

`watch` periodically refreshes the remote contract, verifies its certificate, and evaluates compatibility.

The callback receives the current verification status and certificate identity. Applications choose their own response to incompatibility or uncertainty.

### 5.2. Server API

```typescript
import { HTTPV } from "httpv";

const app = HTTPV.serve({
  routes: {
    "POST /transfer": "./certs/transfer.json"
  },
  fetch: existingHandler
});
```

The server adapter automatically handles HTTPV discovery requests and delegates normal HTTP requests to the existing application handler.

Certificates are generated separately, typically during development or CI, and published alongside the application.

### 5.3. Implementation Requirements

The library SHOULD:

- Support Bun's native HTTP server and Fetch APIs.
- Support existing HTTP applications through lightweight adapters.
- Share certificate verification and serialization logic.
- Support configurable polling intervals and client-defined failure handling.
- Cache verified certificates and compatibility results by cryptographic identity.
- Distinguish invalid certificates, incompatible specifications, and unavailable dependencies.
- Pin trusted SP1 verifier identities and enforce explicit axiom policies.

The client library MUST NOT silently classify an unknown compatibility result as verified.

## 6. Non-Goals

ZKLean and HTTPV do not provide:

- Hardware or remote code execution attestation.
- Per-request cryptographic execution proofs.
- Guaranteed detection of deployment changes not reflected in advertised contracts.
- Automatic generation of meaningful formal specifications.
- Automatic proofs of arbitrary implications between specifications.
- Proofs of the truth of external axioms.
- Guarantees that specifications fully capture intended behavior.
- Strict real-time detection of dependency changes.
- Changes to ordinary HTTP request/response semantics.

## 7. Deliverables

### ZKLean

- Lean export and certificate-generation CLI.
- Nanoda-based SP1 guest checker.
- Succinct certificate generator and verifier.
- Canonical serialization of self-contained public formal models.
- Tests covering valid proofs, invalid proofs, and forbidden axioms.

### HTTPV

- Markdown protocol specification following Internet-Draft/RFC conventions.
- TypeScript/Bun client and server library.
- Certificate discovery and validation.
- Formal dependency-compatibility checking.
- Periodic remote specification monitoring.
- Configurable client failure policies.
- End-to-end examples demonstrating remote API upgrades that preserve or invalidate client assumptions.

## 8. References

- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)
- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111)
- [RFC 2119 / RFC 8174 — Requirement Keywords](https://www.rfc-editor.org/rfc/rfc8174)
- [Lean 4](https://github.com/leanprover/lean4)
- [lean4export](https://github.com/leanprover/lean4export)
- [Nanoda](https://github.com/ammkrn/nanoda_lib)
- [SP1](https://github.com/succinctlabs/sp1)
