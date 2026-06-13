---
id: "002-add-clamp"
repo: toolkit
baseRef: main
adrPath: databank/adr-029-clamp.md
heldOut:
  - "node --test test/clamp.test.js"
  - "node --test test/regression.test.js"
modelMixes:
  - { plan: opus, execute: haiku }
  - { plan: opus, execute: nemotron }
  - { plan: opus, execute: opus }
---
# Add a `clamp` helper to the toolkit

Add a `clamp(value, min, max)` function exported from `src/index.js` that constrains a
number to the inclusive range `[min, max]`:
- returns `min` when `value < min`,
- returns `max` when `value > max`,
- otherwise returns `value` unchanged.

Examples: `clamp(5, 0, 3)` → `3`; `clamp(-1, 0, 3)` → `0`; `clamp(2, 0, 3)` → `2`.

## Acceptance criteria
- AC1 — a `clamp` function is exported. (verify: `node -e "process.exit(typeof require('./src/index.js').clamp==='function'?0:1)"`)
- AC2 — existing exports still load without error. (verify: `node -e "require('./src/index.js')"`)
