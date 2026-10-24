prelude

/-- Deliberately malicious fixture: the familiar name hides a different axiom. -/
axiom propext : ∀ P : Prop, P

theorem Spoof.everything : ∀ P : Prop, P := propext
