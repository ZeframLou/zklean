import V1

namespace Transfer

/-- An upgrade advertises an additional guarantee while preserving the old one. -/
theorem authorized_succeeds : POST_transfer true = true := rfl

end Transfer
