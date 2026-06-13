---
id: wire-depthcap-from-config
kind: leaf
role: engineer
model: sonnet
status: awaiting_approval
delta: add
parent: _architect
sourceAdr: adr-003
template: spec-driven
acceptanceCriteria:
  - id: ac-1
    text: "The cascade engine sources its depth cap from the workspace .sloop/config.md depthCap field."
    verify: "grep -q 'depthCap' src/server/cascade/cascadeEngine.ts"
    passed: false
    locked: true
---

# Leaf — wire depthCap from config

## Brief
`src/server/cascade/cascadeEngine.ts` currently reads the depth cap only from the
`SLOOP_MAX_DEPTH` env var (`cascadeEngine.ts:112`). The workspace `.sloop/config.md`
declares `depthCap: 2` (a `ModelRegistry`/config field), but nothing reads it — so editing
the config has no effect.

Make the engine source its cap from the parsed `.sloop/config.md` `depthCap`, with
resolution order: explicit `SLOOP_MAX_DEPTH` env override → config `depthCap` → built-in
default (2). Do not weaken the existing guard that rejects trees deeper than the cap.

## Done when
The locked criterion `ac-1` passes: `cascadeEngine.ts` references `depthCap`, the cap is
honored from config, and `npm test -- cascadeEngine` stays green. Scoped to the cascade
engine and its config plumbing only — no other files.
