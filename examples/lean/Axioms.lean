import Init

axiom Trusted.stock_policy : Prop
axiom Trusted.evidence : Trusted.stock_policy

/-- Demonstrates exact dependency-closure axiom reporting and client policy. -/
theorem Inventory.assumed_safe : Trusted.stock_policy := Trusted.evidence
