universe u v w

namespace Pipeline

/-- A stage maps inputs satisfying `pre` to outputs satisfying `post`. -/
def Preserves {α : Sort u} {β : Sort v}
    (stage : α → β) (pre : α → Prop) (post : β → Prop) : Prop :=
  ∀ value, pre value → post (stage value)

/-- Guarantees for two independently specified stages compose. -/
theorem compose {α : Sort u} {β : Sort v} {γ : Sort w}
    (first : α → β) (second : β → γ)
    (pre : α → Prop) (middle : β → Prop) (post : γ → Prop)
    (first_safe : Preserves first pre middle)
    (second_safe : Preserves second middle post) :
    Preserves (fun value => second (first value)) pre post := by
  intro value accepted
  exact second_safe (first value) (first_safe value accepted)

/-- A stage meeting a stronger postcondition also meets a weaker one. -/
theorem weaken {α : Sort u} {β : Sort v}
    (stage : α → β) (pre : α → Prop) (strong weak : β → Prop)
    (safe : Preserves stage pre strong)
    (implies : ∀ result, strong result → weak result) :
    Preserves stage pre weak := by
  intro value accepted
  exact implies (stage value) (safe value accepted)

end Pipeline
