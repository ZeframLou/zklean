import Inventory

/-! V1's guarantee stated as an axiom: a specification without its proof. -/
namespace Inventory

axiom reservation_safe (available requested remaining : Nat) :
    POST_reservations available requested = some remaining →
      0 < requested ∧ requested ≤ available ∧ remaining + requested = available

end Inventory
