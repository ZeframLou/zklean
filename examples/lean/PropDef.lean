prelude

/-! A Prop-valued definition keeps its body in its identity. -/
inductive Demo.Yes : Prop
  | intro
inductive Demo.No : Prop
def Demo.Ok : Prop := Demo.Yes
axiom Demo.assumed : Demo.Ok
