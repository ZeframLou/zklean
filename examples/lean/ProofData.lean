import Init

/-- A computational value can contain evidence needed to interpret its definition. -/
structure Demo.CheckedValue where
  value : Bool
  valid : value = value

def Demo.checked : Demo.CheckedValue := ⟨true, rfl⟩

theorem Demo.checked_true : Demo.checked.value = true := rfl
