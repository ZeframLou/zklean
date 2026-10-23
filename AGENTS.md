# Writing rules

- Never apologize or use defensive framing. State problems, corrections, and actions directly.
- Include only information necessary for the reader to understand the project or complete the current task.
- Lead with the purpose, result, or next action. Use plain language and concrete examples.
- Open the README by defining the project and its benefit. Introduce domain examples after that definition.
- Omit development history, unsolicited project-status commentary, version announcements, and implementation inventories unless the task requires them.
- Explain dependencies and internal mechanisms only when the reader needs them to make a decision or perform an action.
- State relevant requirements and limitations directly. Keep instructions accurate; do not hide prerequisites or claim that an unavailable workflow works.
- Put detailed protocol, architecture, and contributor material in dedicated documentation. Keep the README focused on purpose, installation, and a runnable example.
- Write for developers new to formal verification and cryptographic proofs. Explain those concepts separately before using them as shared vocabulary.
- Describe ZKLean's trust boundary between certificate producers and verifiers: the trusted checker identity, permitted axioms, and what acceptance establishes. Keep HTTPV's server trust model in its own repository. Keep the README's security section to one paragraph of at most three sentences.
- Document the intended release installation with one curl command; keep CI artifact handling in contributor documentation.
- Keep ZKLean's proving and local verification independent of HTTPV. HTTPV consumes certificates through a configured verifier and does not invoke a prover or the ZKLean CLI.
- Apply [GOV.UK's clear language guidance](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/), its [structure guidance](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-structure/), and [Google's audience guidance](https://developers.google.com/tech-writing/one/audience): explain terms on first use, put useful information first, and remove repetition.
