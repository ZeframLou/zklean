import Init

namespace Transfer

/-- A different operation with the same signature: reject every transfer. -/
def POST_transfer (authorized : Bool) : Bool := false

/-- The type has the same syntax as V1, but POST_transfer has a different body. -/
theorem transfer_safe (authorized : Bool) :
    POST_transfer authorized = true → authorized = true := by
  intro h
  exact Bool.noConfusion h

end Transfer
