import Init

axiom Trusted.authorization : Prop
axiom Trusted.evidence : Trusted.authorization

/-- Demonstrates exact dependency-closure axiom reporting and client policy. -/
theorem Transfer.assumed_safe : Trusted.authorization := Trusted.evidence
