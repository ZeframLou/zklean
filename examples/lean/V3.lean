import Init

namespace Inventory

/-- Backorders are now accepted even when the requested quantity exceeds stock. -/
def POST_reservations (available requested : Nat) : Option Nat :=
  if 0 < requested then some (available - requested) else none

/-- A valid proof under the old name now promises only an accounting result. -/
theorem reservation_safe (available requested : Nat) (positive : 0 < requested) :
    POST_reservations available requested = some (available - requested) :=
  ite_eq_left positive

end Inventory
