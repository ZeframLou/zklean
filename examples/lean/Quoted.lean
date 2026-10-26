/-! A name component containing a dot, written in Lean's quotes. -/

def «rate.limit» : Nat := 10

theorem «rate.limit».pos : 0 < «rate.limit» := by decide
