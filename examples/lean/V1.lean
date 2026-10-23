import Init

namespace Transfer

/-- Formal operation for POST /transfer: true means an authorized request. -/
def POST_transfer (authorized : Bool) : Bool := authorized

/-- A successful transfer requires authorization. -/
theorem transfer_safe (authorized : Bool) :
    POST_transfer authorized = true → authorized = true := fun h => h

end Transfer
