import Init

namespace Inventory

/-- Atomic POST /reservations for one SKU: success returns the stock remaining. -/
def POST_reservations (available requested : Nat) : Option Nat :=
  if 0 < requested ∧ requested ≤ available then
    some (available - requested)
  else
    none

end Inventory
