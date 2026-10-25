import Init

/-! Mutual and nested inductive types, whose blocks are hashed as one unit. -/
namespace Shapes

mutual
inductive Odd : Nat → Prop
  | succ : Even n → Odd (n + 1)
inductive Even : Nat → Prop
  | zero : Even 0
  | succ : Odd n → Even (n + 1)
end

/-- A nested inductive: its constructor takes a list of itself. -/
inductive Tree where
  | node : List Tree → Tree

theorem even_zero : Even 0 := .zero

theorem leaf_eq : Tree.node [] = Tree.node [] := rfl

end Shapes
