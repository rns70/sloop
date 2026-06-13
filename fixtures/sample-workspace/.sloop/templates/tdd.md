---
id: tdd
name: Test-driven
stages:
  - { name: write-failing-test, role: engineer, model: sonnet }
  - { name: implement,          role: engineer, model: haiku }
  - { name: refactor,           role: engineer, model: haiku }
---

# Test-driven

Per unit, loop: **write a failing test → implement to green → refactor**. The failing
test encodes the acceptance criterion; the `verify` command is that test.

> Hackathon status: stub. The picker proves templates are pluggable; `spec-driven` is
> the polished path.
