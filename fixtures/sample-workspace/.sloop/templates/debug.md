---
id: debug
name: Debug
stages:
  - { name: reproduce,         role: debugger, model: sonnet, gate: true }
  - { name: localize,          role: debugger, model: sonnet }
  - { name: fix,               role: engineer, model: haiku }
  - { name: regression-verify, role: qa,       model: sonnet, gate: true }
---

# Debug

Reproduce-first defect repair: **reproduce → localize → fix → regression-verify**.

1. **reproduce** *(gate)* — write a failing regression test that reproduces the defect and
   confirm it fails for the right reason. Lock it (`locked: true`); it is the leaf's
   `verify` command.
2. **localize** — trace the failure to its root cause with `path:line` evidence.
3. **fix** — make the smallest change that turns the reproduction test green without
   weakening it.
4. **regression-verify** *(gate)* — the reproduction test **and** the existing suite must
   pass; QA confirms on exit 0.

Reproducing the bug as a locked test first is what makes the fix verifiable rather than
plausible.
