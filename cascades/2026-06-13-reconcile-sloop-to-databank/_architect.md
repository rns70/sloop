---
id: _architect
kind: architect
role: architect
model: opus
status: awaiting_approval
delta: add
children: [wire-depthcap-from-config]
sourceAdr: adr-003
template: spec-driven
acceptanceCriteria: []
---

# Architecture loop — reconcile sloop to its own databank

## Diff read
16 `add` deltas — the whole databank is new. Verifying each criterion shows the codebase
already satisfies **26 of 30** criteria. Four are red:

- **ADR-003 `ac-2`** — actionable: the `depthCap` field in `.sloop/config.md` is not
  consumed by the cascade engine (it reads `SLOOP_MAX_DEPTH`). One leaf below.
- **ADR-006 `ac-2`, ADR-012 `ac-2`, ADR-013 `ac-2`** — transient: `npm run typecheck` /
  `npm run build` fail because a `moveAdr` contract migration is mid-landing across other
  work packages. **Not staffed** — touching those in-flight files would collide in the
  shared checkout. Left to their owning WP; they re-green on the next verify once that
  migration completes.

## Proposed tree (spec-driven: plan → implement → verify)
1. **wire-depthcap-from-config** *(engineer / sonnet)* — satisfy ADR-003 `ac-2`: source
   the depth cap from `.sloop/config.md` `depthCap` (falling back to `SLOOP_MAX_DEPTH`,
   then the built-in default) so the declared config value is actually enforced.

This loop is **done** only when its one child is done and ADR-003 `ac-2`'s `verify`
exits 0 — at which point the codebase matches the entire databank. Awaiting approval
before fan-out.
