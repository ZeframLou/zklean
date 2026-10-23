import Init

namespace AxiomPolicy

theorem ext (P Q : Prop) (h : P ↔ Q) : P = Q := propext h

theorem choice_used {α : Sort u} (h : Nonempty α) : Nonempty α :=
  ⟨Classical.choice h⟩

theorem quotient {α : Sort u} (r : α → α → Prop) (a b : α) (h : r a b) :
    Quot.mk r a = Quot.mk r b := Quot.sound h

end AxiomPolicy
