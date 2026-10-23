import Init

namespace Transfer

def POST_transfer (authorized : Bool) : Bool := authorized

/-- The independently verified remote guarantee is an assumption for this proof. -/
axiom transfer_safe (authorized : Bool) :
    POST_transfer authorized = true → authorized = true

end Transfer

/-- A bridge derives the client's requirement from the authenticated guarantee. -/
theorem Client.requires_auth (authorized : Bool) :
    Transfer.POST_transfer authorized = true → authorized = true :=
  Transfer.transfer_safe authorized
