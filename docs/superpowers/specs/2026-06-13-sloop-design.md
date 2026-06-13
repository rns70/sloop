# sloop — Design Document

**Date:** 2026-06-13
**Status:** Draft for review
**Author:** Jelle Maas (with Claude)

---

## 1. Overview

**sloop is an IDE for agent factories: a desktop app that keeps a codebase continuously reconciled to a databank of requirement documents (ADRs).**

You maintain your requirements as a corpus of markdown ADR documents — the desired state of the system. When you change that corpus (add, edit, or delete requirements), you kick off a **cascade**: a run that diffs the databank against its previous committed version, and for every actionable delta spawns a tree of **agent loops** that drive the codebase back into agreement with the requirements.

The defining property: **when the root loop reports done, the codebase matches the databank.** "Are we in sync with our requirements?" collapses to reading a single bit.

sloop is a **conductor**, not its own coding agent. Leaf work is delegated to an existing coding agent (Claude Code first). sloop owns decomposition, routing, gating, persistence, and the convergence guarantee.

### Reference points
- Closest analog: Google Antigravity's "Agent Manager / Mission Control" (agent-first IDE, fleet of async agents) — but spec-driven and reconciliation-based rather than chat-driven.
- Pattern lineage: **Plan-then-Execute** (expensive planner, cheap executors) and the **Kubernetes controller / reconciliation loop** (desired state → detect drift → converge), applied to a requirements corpus.

---

## 2. Vocabulary

| Term | Definition |
|------|------------|
| **Databank** | The corpus of ADR / requirement markdown documents. Desired state, source of truth. |
| **ADR** | A single requirement document. Contains requirements and **acceptance criteria**. |
| **Cascade** | A run triggered by a change to the databank. Diffs databank `@HEAD` vs the last committed/accepted version, produces a worklist of deltas, and spawns the root loop. |
| **Delta** | One actionable change detected by the cascade, classified as `add` / `change` / `delete`. |
| **Loop** | The unit of work. A markdown file with frontmatter (role, model, status, parent) and a body (its plan / criteria / children). Loops form a tree of unbounded depth. |
| **Architecture loop** | The root loop of a cascade. A planning loop on a big model: reads the diff, decomposes work, staffs and spawns child loops. Does not write code. |
| **Inner loop** | A non-root, non-leaf loop. May plan further and spawn its own children. |
| **Leaf loop** | A loop small enough that its acceptance criteria can be verified directly. Delegates to an external coding agent to do the work. |
| **Role** | The persona/type of a loop (Architect, Engineer, QA, Security reviewer, Pentester, …). User-definable. Carries a default model and a default prompt/brief. |
| **Acceptance criteria** | Verifiable conditions attached to a requirement and/or a loop. A loop passes only when its criteria are satisfied. |

---

## 3. The convergence invariant (the heart of the system)

A loop is **done** if and only if:
1. **All of its child loops are done**, and
2. **Its own acceptance criteria pass.**

Recursion bottoms out at leaves — units small enough to verify directly. Therefore completion **bubbles up the tree**:

```
root loop done
  ⟺ every descendant loop done
  ⟺ every acceptance criterion in the databank's changed set is satisfied
  ⟺ the codebase matches the databank (for this cascade's scope)
```

Consequences that drive the design:
- A loop's status is **derived**, not just stored: an inner loop cannot be "done" while a child is failing or running.
- Tree depth is emergent — however deep it takes to decompose a requirement into verifiable criteria. **No depth cap.**
- The architecture loop is not done when it finishes *planning*; it is done when its whole subtree converges.
- A failed/blocked leaf propagates upward as a **blocked** root — surfacing exactly where reconciliation stalled.

---

## 4. Architecture

### 4.1 Form factor & stack
- **Tauri desktop app.** Rust core (orchestration, file watching, git, process management, agent supervision) + web frontend (Notion-style UI).
- **Local-first.** Operates on a folder (the workspace) on disk. No server required for single-user.

### 4.2 Markdown is the system
Markdown files are **both the persistence layer and the change-tracking layer.** There is no separate database for loop/cascade state; the files *are* the state, and git *is* the history.

- The UI is a view over these files. Editing in the UI writes markdown; editing the markdown externally is reflected in the UI (file watcher).
- Each loop and cascade is a markdown file with YAML frontmatter for structured properties and a markdown body for human-readable content.
- State transitions are commits. The audit trail of a cascade is its git log.

Proposed workspace layout:
```
workspace/
  databank/                 # the ADR corpus (desired state)
    adr-007-token-rotation.md
    adr-012-device-trust.md
    ...
  cascades/
    2026-06-13-requirements-sync/
      _cascade.md            # cascade metadata, delta summary
      _architect.md          # root architecture loop
      adr-007-rotate-tokens.md          # inner loop
      adr-007-rotate-tokens/            # children of that loop
        update-token-service.md         # leaf loop
        migrate-session-store.md        # leaf loop
      ...
  .sloop/
    roles/                   # loop-type library (one md per role)
      architect.md
      engineer.md
      qa.md
      security.md
    config.md                # model routing defaults, executor config
```

### 4.3 Loop file schema (frontmatter)
```yaml
---
id: adr-007-rotate-tokens
kind: inner            # architect | inner | leaf
role: engineer
model: sonnet          # resolved from role default unless overridden
status: executing      # planned | awaiting_approval | queued | executing | blocked | review | done | failed
delta: change          # add | change | delete  (which diff spawned it)
parent: _architect
children: [update-token-service, migrate-session-store]
source_adr: adr-007
acceptance_criteria:
  - id: ac-1
    text: "Refresh tokens rotate every ≤15m"
    passed: false
executor: claude-code  # which external agent runs this (leaves)
---
```
Body holds the human-readable plan, the brief handed to the agent, and notes.

### 4.4 Execution engine
- sloop defines an **Executor** abstraction; the first (and MVP) adapter is **Claude Code**, invoked as a subprocess per leaf.
- A leaf hands the external agent: the scoped task, the relevant ADR context, and its acceptance criteria. sloop captures output, detects completion, and runs the criteria verification step.
- **Model routing** = which model/agent invocation is used per loop. Defaults flow from role (Architect→opus, Engineer→sonnet, leaf work→haiku), overridable per loop. (See §6.)
- Pluggable executors are designed for but not implemented in MVP (YAGNI until a second runtime is needed).

---

## 5. Cascade lifecycle

1. **Define the change.** User edits the databank (add/edit/delete ADRs) and triggers a cascade.
2. **Diff.** sloop computes the delta set: databank working tree vs last accepted commit. Each changed ADR yields one or more deltas tagged `add`/`change`/`delete`. (Diff is git-based; a planning agent interprets semantic intent — see Open Questions on semantic vs textual diff.)
3. **Architecture loop.** A root loop on a big model reads the deltas, decomposes the work into a tree of role-typed child loops with acceptance criteria, and proposes it.
4. **Checkpoint (human gate).** The proposed tree is presented for approval: **approve all · edit · skip**. Inner loops do not run until approved. (Confirmed requirement; not optional.)
5. **Fan out & execute.** Approved loops run. Inner loops may recurse (plan → spawn). Leaf loops delegate to the executor and then verify acceptance criteria.
6. **Bubble up.** As leaves pass, parents re-evaluate via the convergence invariant. Failures surface as a blocked subtree.
7. **Done.** Root loop done ⟹ codebase matches databank for this cascade. Result is a git history of the whole run.

### Loop state machine
```
planned → awaiting_approval → queued → executing → review → done
                    │                      │           │
                    └── skip               └──> blocked/failed (propagates up)
```

---

## 6. Roles & model routing

- **Loop-types library** (`.sloop/roles/*.md`): each role is a markdown file defining its responsibility, default model, and a prompt/brief template. Ships with Architect, Engineer, QA, Security reviewer, Pentester; **user-definable** (`+ New type`).
- Roles render as colored tags in the UI.
- **Routing principle:** expensive reasoning at the root, cheap doing at the leaves. Resolution order for a loop's model: explicit per-loop override → role default → global default.
- Because roles are markdown, routing rules and personas are versioned and diffable like everything else.

---

## 7. UI surfaces (Notion-style, lean)

Aesthetic: clean, light, typographic, minimal — Notion-like. Three primary areas:

1. **Databank** — browse/edit ADRs. Markdown editor with **inline diff vs last accepted** (core requested capability).
2. **Cascades / Mission Control** — the live **loop tree** for a cascade. Nodes show role tag, model chip, status; expandable to children of unbounded depth; root status answers "in sync?". The checkpoint approval lives here.
3. **Loop page** — a single loop rendered as a Notion page: frontmatter as inline **properties**, body as the plan, children as a nested list. This is just the markdown file, viewed nicely.
4. **Loop-types library** — manage roles.

Everything shown is a view over markdown on disk; there is no hidden state.

---

## 8. Cross-cutting concerns

- **Reliability / idempotency.** A re-run cascade should converge to the same tree for the same diff; loops are resumable (status persisted in files). Interrupted leaves can be retried with backoff. Re-running a passing loop is a no-op.
- **Failure handling.** A failed leaf → `blocked` subtree → `blocked` root, with the stall point visible. No silent partial "done." Retries are explicit and bounded; persistent failure requires human intervention at the checkpoint or loop page.
- **Observability.** Every state transition is a git commit; the cascade's git log is the audit trail. Live agent output is streamed to the loop page. (Structured logs/metrics for agent runs: Phase 2.)
- **Security.** sloop spawns external agents that modify code and may run tools. MVP mitigations: the human checkpoint before execution; agents run against the working tree under git (every change reviewable/revertible); Security/Pentester roles are first-class so safety review is part of the tree, not an afterthought. Sandboxing/permission policy for executors: Phase 2.
- **Git as substrate.** Cascades operate on branches; approving and converging produces commits. Rollback = git revert of a cascade's commits.

---

## 9. Scope & build sequence

This is a large system. It will be built in phases; **Phase 1 is the first implementation-plan target.** Later phases get their own specs/plans.

**Phase 1 — MVP (the spine, end to end):**
- Tauri app shell + Notion-style UI skeleton.
- Workspace on disk: databank + markdown loop/cascade files + git integration.
- Databank browse/edit with inline diff.
- Cascade trigger → git diff → architecture loop (big model) proposes a tree.
- Checkpoint approval UI.
- Leaf execution via **one executor: Claude Code subprocess**, with acceptance-criteria verification.
- Convergence invariant: status bubbles up; root-done = in-sync.
- Loop-types library with the starter roles + per-loop model override.

**Phase 2+ (deferred):**
- Pluggable executor adapters (beyond Claude Code).
- Executor sandboxing/permission policy.
- Structured metrics/telemetry for agent runs and cost.
- Multi-user / sync / collaboration.
- Reconciliation against the codebase or external sources (current design diffs docs-vs-docs only).
- Cost budgeting / model-routing optimization dashboards.

---

## 10. Open questions

1. **Diff fidelity:** Is the cascade diff purely git-textual (then the architect agent interprets), or do we want structured ADRs (stable IDs per requirement/criterion) so deltas map deterministically to requirements? *Leaning: structured ADRs with stable criterion IDs to make convergence checkable — to confirm.*
2. **Concurrency & ordering:** Do sibling inner loops run fully in parallel, or can the architect declare dependencies between them?
3. **Acceptance-criteria verification:** How is a criterion checked — agent self-report, a test/command the leaf must make pass, or a separate QA-role loop that adjudicates? (Affects trust in "done.")
4. **Cascade scope on conflict:** What happens if the databank changes again while a cascade is mid-flight?

---

## 11. Out of scope (YAGNI for now)

- Cloud/hosted multi-user mode.
- A bespoke coding-agent runtime (we orchestrate existing agents).
- Non-markdown persistence.
- Reconciliation sources other than the doc-vs-doc git diff.
