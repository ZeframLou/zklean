import V1

namespace Inventory

/-- The upgrade also guarantees that every valid reservation succeeds. -/
theorem valid_request_succeeds (available requested : Nat)
    (positive : 0 < requested) (fits : requested ≤ available) :
    POST_reservations available requested = some (available - requested) :=
  ite_eq_left ⟨positive, fits⟩

end Inventory
