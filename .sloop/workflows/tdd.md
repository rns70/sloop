---
id: tdd
name: Test-driven
steps:
  - { name: write-failing-test, role: engineer, model: sonnet, gate: true }
  - { name: implement,          role: engineer, model: haiku }
  - { name: refactor,           role: engineer, model: haiku, gate: true }
---

# Test-driven

Per unit, loop: **write a failing test → implement to green → refactor**.

1. **write-failing-test** *(gate)* — write a test that encodes the acceptance criterion,
   run it, and confirm it fails for the right reason. Commit the failing test, then
   **lock** it (`locked: true`): that test is the leaf's `verify` command.
2. **implement** — write the smallest code that turns the test green. Do **not** edit the
   test to make it pass — altering a locked test is reward-hacking, not progress. If the
   test looks wrong, escalate upward.
3. **refactor** *(gate)* — improve the code with the suite staying green; the locked test
   must still pass unchanged.

The failing test is the verify gate, so the convergence invariant holds by construction:
the unit is done exactly when its locked test exits 0.

## Defect repair (reproduce-first)

Fixing a bug is TDD applied to a defect: the failing test is a **reproduction**.
**reproduce** — write a failing regression test that triggers the defect and confirm it
fails for the right reason; lock it as the leaf's `verify`. **localize** — trace the
failure to its root cause with `path:line` evidence. **implement/refactor** as above. The
gate is the reproduction test plus the existing suite, both green. Reproducing the bug as
a locked test first is what makes the fix verifiable rather than plausible.
