import Init

namespace Transfer

/-- This version accepts unauthorized transfers as well. -/
def POST_transfer (_authorized : Bool) : Bool := true

/-- The same name now certifies a different proposition. Names are insufficient. -/
theorem transfer_safe (authorized : Bool) : POST_transfer authorized = true := rfl

end Transfer
