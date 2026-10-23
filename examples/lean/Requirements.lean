import Init

namespace Transfer

def POST_transfer (authorized : Bool) : Bool := authorized

end Transfer

/-- The client's assumption, deliberately named independently of the provider. -/
axiom Client.requires_auth (authorized : Bool) :
    Transfer.POST_transfer authorized = true → authorized = true
