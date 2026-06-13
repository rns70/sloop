---
id: 2026-06-13-reconcile-sloop-to-databank
createdAt: 2026-06-13T12:00:00.000Z
template: spec-driven
deltas: { add: 16, change: 0, delete: 0 }
rootLoopId: _architect
status: awaiting_approval
---

# Cascade — reconcile sloop to its own databank

The first **self-cascade**: sloop reconciling sloop. Triggered by adding the `databank/`
that captures sloop's own design decisions (ADR-001 … ADR-016) — 16 `add` deltas.

Running every criterion's `verify` command shows sloop is **already largely converged**
with its own requirements: **26 of 30 acceptance criteria pass.** The four reds split
into one standing design drift and three transient build failures:

- **Standing drift — ADR-003 `ac-2`:** `.sloop/config.md` declares `depthCap`, but the
  cascade engine reads the cap from a `SLOOP_MAX_DEPTH` env var instead, so the config
  field is unconsumed. This is real work; the architect staffs a leaf for it.
- **Transient — ADR-006 `ac-2`, ADR-012 `ac-2`, ADR-013 `ac-2`** (`npm run typecheck` /
  `npm run build`): currently red because a `moveAdr` contract migration is **half-landed
  across other work packages** — `FilesService` gained `moveAdr` but `FilesServiceImpl`
  and several test fakes have not caught up yet. These flip green when that migration
  completes. The architect **does not** staff leaves for them: fixing another WP's
  in-flight files would collide in the shared checkout (a known hazard). They are flagged
  and left to their owning WP.

The architect therefore proposes a one-leaf tree rooted at `_architect`. **Awaiting
approval** at the checkpoint.
