---
id: "003-sum-handles-empty"
repo: toolkit
baseRef: main
adrPath: databank/adr-031-sum-empty.md
heldOut:
  - "node --test test/sum-empty.test.js"
  - "node --test test/regression.test.js"
modelMixes:
  - { plan: opus, execute: haiku }
  - { plan: opus, execute: nemotron }
  - { plan: opus, execute: opus }
---
# `sum` must handle the empty array

Requirement change: `sum(nums)` in `src/index.js` currently throws on an empty array
(`[].reduce` with no initial value). Change it so `sum([])` returns `0`, while keeping
all existing behavior: `sum([1, 2, 3])` must still equal `6`.

This is a behavior change to an existing function, not a new export — the held-out
suite checks both the new empty-array case and that the non-empty case is unbroken.

## Acceptance criteria
- AC1 — `sum([])` does not throw. (verify: `node -e "const s=require('./src/index.js').sum; s([]);"`)
- AC2 — `sum([])` is `0`. (verify: `node -e "const s=require('./src/index.js').sum; process.exit(s([])===0?0:1)"`)
