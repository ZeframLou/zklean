import Init

namespace Inventory

/-- A service that rejects all requests has a different operation definition. -/
def POST_reservations (_available _requested : Nat) : Option Nat := none

/-- The same proposition syntax as V1, but interpreted under different behavior. -/
theorem reservation_safe (available requested remaining : Nat) :
    POST_reservations available requested = some remaining →
      0 < requested ∧ requested ≤ available ∧ remaining + requested = available := by
  intro h
  cases h

end Inventory
