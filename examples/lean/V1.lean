import Inventory

namespace Inventory

/-- A successful reservation is positive, fits in stock, and conserves units. -/
theorem reservation_safe (available requested remaining : Nat) :
    POST_reservations available requested = some remaining →
      0 < requested ∧ requested ≤ available ∧ remaining + requested = available := by
  intro h
  unfold POST_reservations at h
  split at h
  next valid =>
    have same := Option.some.inj h
    subst remaining
    exact ⟨valid.1, valid.2, Nat.sub_add_cancel valid.2⟩
  next => contradiction

end Inventory
