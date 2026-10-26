namespace Progress

/-- The percentage of a task that is done, rounded down. An empty task
counts as 0%. -/
def percent (done total : Nat) : Nat :=
  if total = 0 then 0 else done * 100 / total

/-- A progress bar never shows more than 100%. -/
theorem percent_le_100 (done total : Nat) (h : done ≤ total) :
    percent done total ≤ 100 := by
  unfold percent
  split
  · exact Nat.zero_le _
  · next nonempty =>
    apply Nat.div_le_of_le_mul
    exact Nat.mul_le_mul_right 100 h

end Progress
