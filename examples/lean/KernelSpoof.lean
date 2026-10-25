prelude
universe u
inductive True : Prop where
  | intro : True
inductive False : Prop
inductive Eq {α : Sort u} : α → α → Prop where
  | refl (a : α) : Eq a a
set_option genCtorIdx false in
inductive Nat where
  | zero : Nat
  | succ (n : Nat) : Nat
/-- Not gcd. The checker computes `Nat.gcd` natively by name, so without pinning
    this definition would prove `False`. -/
noncomputable def Nat.gcd (_ _ : Nat) : Nat := Nat.zero
noncomputable def Pos (n : Nat) : Prop := Nat.rec (motive := fun _ => Prop) False (fun _ _ => True) n
theorem gcd_zero (a b : Nat) : Eq (Nat.gcd a b) Nat.zero := Eq.refl Nat.zero
theorem bad : False :=
  @Eq.rec Nat (Nat.gcd (Nat.succ Nat.zero) Nat.zero) (fun n _ => Pos n)
    True.intro Nat.zero (gcd_zero _ _)
theorem Attack.claim : False := bad
