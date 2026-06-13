# sloop — Design Document

**Date:** 2026-06-13
**Status:** Approved — hackathon build
**Author:** Jelle Maas (with Claude)

> **Hackathon mode:** scope is trimmed for speed. The goal is a compelling demo of the *one* novel idea — the convergence invariant — not a complete product. Anything not on the demo happy path is deferred (see §9).

---

## 1. Overview

**sloop is an IDE for agent factories: a local app that keeps a codebase continuously reconciled to a databank of requirement documents (ADRs).**

You maintain your requirements as a corpus of markdown ADR documents — the desired state of the system. When you change that corpus (add, edit, or delete requirements), you kick off a **cascade**: a run that diffs the databank against its previous committed version, and for every actionable delta spawns a tree of **agent loops** that drive the codebase back into agreement with the requirements.

The defining property: **when the root loop reports done, the codebase matches the databank.** "Are we in sync with our requirements?" collapses to reading a single bit.

sloop is a **conductor**, not its own coding agent. Leaf work is delegated to embedded **Pi agents** (any registered model/provider — §4.4). sloop owns decomposition, routing, gating, persistence, and the convergence guarantee.

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
| **Loop** | The unit of work. A markdown file with frontmatter (role, model, status, parent) and a body (its plan / criteria / children). Loops form a tree — conceptually unbounded, but bounded in practice by a configurable depth/loop cap (safety). |
| **Template** | A reusable definition of *how* the architect decomposes work: the stages, which roles staff each stage, and their ordering. A markdown file in `.sloop/templates/` (e.g. `waterfall.md`, `tdd.md`, `spec-driven.md`). Copyable and editable. See §6. |
| **Architecture loop** | The root loop of a cascade. A planning loop on a big model: reads the diff, decomposes work, staffs and spawns child loops. Does not write code. |
| **Inner loop** | A non-root, non-leaf loop. May plan further and spawn its own children. |
| **Leaf loop** | A loop small enough that its acceptance criteria can be verified directly. Delegates to an embedded Pi agent to do the work. |
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
- Tree depth is emergent — however deep it takes to decompose a requirement into verifiable criteria. Conceptually unbounded; in practice a **configurable depth/loop cap** prevents runaway cost (a hard requirement for safe live demos).
- A criterion's truth is established by its **`verify` command** (exit 0 = passed) wherever possible — this is what makes the invariant *real* rather than self-reported. Criteria without a command fall back to QA-role adjudication (Phase 2).
- The architecture loop is not done when it finishes *planning*; it is done when its whole subtree converges.
- A failed/blocked leaf propagates upward as a **blocked** root — surfacing exactly where reconciliation stalled.

---

## 4. Architecture

### 4.1 Form factor & stack
- **Local TypeScript web app** (chosen for hackathon iteration speed over the originally-considered Tauri/Rust build).
  - **Frontend:** Vite + React + Tailwind. Notion-style UI ships fastest here.
  - **Backend:** a thin Node layer (same repo) for file I/O, git (`simple-git`), running embedded Pi agents, and streaming agent output to the UI (WebSocket/SSE).
- **Local-first.** Operates on a folder (the workspace) on disk. Runs on `localhost`; single-user; no hosted service.
- All orchestration logic lives in TS. There is no Rust core.

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
    workflows/               # workflows (the steps — §6)
      spec-driven.md         # default
      waterfall.md
      tdd.md
      agile.md
    config.md                # model routing defaults, executor config, depth cap
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
sourceAdr: adr-007
acceptanceCriteria:
  - id: ac-1
    text: "Refresh tokens rotate every ≤15m"
    verify: "npm test -- rotation"   # exit 0 = passed; optional
    passed: false
workflow: spec-driven  # workflow the architect followed (§6)
executor: pi           # Pi agent runtime; provider comes from the model registry
---
```
Body holds the human-readable plan, the brief handed to the agent, and notes.

> **Frontmatter keys match the `LoopFrontmatter` TS interface exactly (camelCase)** so `gray-matter` parses straight into the type with no key remapping. Same rule for ADR and config frontmatter.

### 4.4 Execution engine — built on Pi
sloop does not hand-roll an agent runtime or per-provider clients. It embeds **[Pi](https://github.com/earendil-works/pi)** (`earendil-works/pi`, MIT, TypeScript):
- **`@earendil-works/pi-ai`** — the unified multi-provider LLM layer for *all* model calls (architect planning and leaf execution). Providers are registered via `registerProvider({ baseUrl, apiKey, api })`; Anthropic and OpenAI are built in, and **Nebius (NVIDIA Nemotron) is registered as an OpenAI-compatible provider** (`api: 'openai-completions'`, `baseUrl: https://api.studio.nebius.ai/v1`). This is also how routing/hand-off between a big planner model and cheap executor models is expressed.
- **Pi's `agent` package** — the agent runtime (tool-calling + state). sloop's single **Executor** wraps a Pi agent: given a leaf, it runs a Pi coding agent against the target repo on the leaf's resolved model (any provider), streams output, then runs the criteria `verify` step.
- A leaf gets the scoped task, relevant ADR context, and its acceptance criteria. One executor, provider-agnostic — no Claude Code subprocess and no bespoke OpenAI loop.
- **Model routing** = which registry alias (→ Pi provider+model) is used per loop. Defaults flow from role/template, overridable per loop (§6.3).

---

## 5. Cascade lifecycle

1. **Define the change.** User edits the databank (add/edit/delete ADRs) and triggers a cascade.
2. **Diff.** sloop computes the delta set: databank working tree vs last accepted commit. Each changed ADR yields one or more deltas tagged `add`/`change`/`delete`. (Diff is git-based; a planning agent interprets semantic intent — see Open Questions on semantic vs textual diff.)
3. **Architecture loop.** A root loop on a big model reads the deltas and decomposes the work into a tree of role-typed child loops with acceptance criteria, **following the selected process template** (§6) for the stage structure. Proposes the tree.
4. **Checkpoint (human gate).** The proposed tree is presented for approval: **approve all · edit · skip**. Inner loops do not run until approved. (Confirmed requirement; not optional.)
5. **Fan out & execute.** Approved loops run. Inner loops may recurse (plan → spawn), up to the configured **depth/loop cap**. Leaf loops delegate to the executor and then verify acceptance criteria (running each criterion's `verify` command).
6. **Bubble up.** As leaves pass, parents re-evaluate via the convergence invariant. Failures surface as a blocked subtree.
7. **Done.** Root loop done ⟹ codebase matches databank for this cascade. Result is a git history of the whole run.

### Loop state machine
```
planned → awaiting_approval → queued → executing → review → done
                    │                      │           │
                    └── skip               └──> blocked/failed (propagates up)
```

---

## 6. Roles, workflows & model routing

**Roles** = *who* does the work. **Workflows** = *the shape of the tree* (the steps). These are orthogonal: a workflow references roles to staff its steps.

### 6.1 Roles (loop types)
- **Loop-types library** (`.sloop/roles/*.md`): each role is a markdown file — frontmatter sets defaults (`defaultModel`, `color`), the body is the **brief the agent receives**. Editable in the shared markdown editor (§7) like any other file. Ships with Architect, Engineer, QA, Security reviewer, Pentester; **user-definable** (`+ New type`).
- Roles render as colored tags in the UI.

### 6.2 Workflows (steps)
A **workflow** prescribes how the architect loop decomposes a delta into steps — the methodology, copyable like a starter. Each is a markdown file in `.sloop/workflows/`:
- `spec-driven.md` *(default)* — plan → implement → verify.
- `waterfall.md` — requirements → design → implement → verify → deploy, sequential (each step gated on the previous).
- `tdd.md` — write failing test → implement → refactor, looped per unit.
- `agile.md` — plan → implement → verify, looped per story.

A workflow file declares its steps and the role + default model for each (in frontmatter), plus guidance the architect follows when instantiating the tree. The architect reads the chosen workflow and stamps out child loops to match. **No new runtime machinery** — a workflow is structured prompt scaffolding plus step metadata. Users copy and edit workflows to invent their own methodology.

The workflow for a cascade is chosen at kickoff (defaulting to `spec-driven`) and recorded on each loop's `workflow` field.

### 6.3 Model routing & providers
- **Principle:** expensive reasoning at the root, cheap doing at the leaves. Resolution order for a loop's model: explicit per-loop override → workflow-step default → role default → global default.
- Because roles and workflows are markdown, routing rules, personas, and methodologies are versioned and diffable like everything else.

**Providers (multi-provider, not Anthropic-only).** A `model` id resolves through a **model registry** in `.sloop/config.md` to a provider. Two providers ship:
- `anthropic` — Claude models (opus/sonnet/haiku), via Pi's built-in Anthropic provider.
- `nebius` — models hosted on **Nebius AI Studio** via its **OpenAI-compatible API**, e.g. **NVIDIA Nemotron** (`nvidia/llama-3.1-nemotron-70b-instruct`) and other open models. Base URL + `apiKeyEnv` come from the registry.

Registry entry shape (in `.sloop/config.md` frontmatter):
```yaml
models:
  opus:        { provider: anthropic, id: claude-opus-4-8 }
  sonnet:      { provider: anthropic, id: claude-sonnet-4-6 }
  haiku:       { provider: anthropic, id: claude-haiku-4-5-20251001 }
  nemotron:    { provider: nebius, id: nvidia/llama-3.1-nemotron-70b-instruct }
providers:
  anthropic: { apiKeyEnv: ANTHROPIC_API_KEY }
  nebius:    { baseUrl: https://api.studio.nebius.ai/v1, apiKeyEnv: NEBIUS_API_KEY }
```
So the architect could plan on `nemotron` and execute leaves on `haiku`, or any mix — routing is provider-agnostic. The registry is the single place a new provider/model is added. At startup sloop maps this registry onto Pi via `pi-ai`'s `registerProvider` (the `nebius` entry registers as an OpenAI-compatible provider), so Pi handles the actual provider dispatch.

---

## 7. UI surfaces (Notion-style, lean)

Aesthetic: clean, light, typographic, minimal — Notion-like.

**The markdown editor is the core primitive.** One shared editor — **BlockNote**, block-based with markdown import/export and an **inline-diff mode** (adds/removes shown within the document flow, not a side rail) — is reused for *every* editable file: ADR entries, role instruction files, and template files. They are all just simple markdown files on disk. The cascade/Mission Control view is the one surface that uses bespoke, non-editor components.

Primary areas:

1. **Databank** — browse/edit ADRs, each a plain markdown file opened in the shared editor, with **inline diff vs last accepted commit**.
2. **Cascades / Mission Control** — the live **loop tree** for a cascade (bespoke components). Nodes show a role tag, model + delta as quiet muted text, and status as a small labeled dot; expandable to children; root status answers "in sync?". The checkpoint approval lives here.
3. **Loop page** — a single loop rendered as a Notion page: frontmatter as **properties**, body as the plan, streamed agent output, children as a nested list.
4. **Libraries** — roles and templates as quiet lists; selecting one opens its markdown file in the **same shared editor** (frontmatter sets defaults; the body is the editable brief/guidance).

Everything shown is a view over markdown on disk; there is no hidden state.

**Navigation is the left sidebar only** (Databank · Cascades · Libraries) — there are no top tabs. The approved visual target lives in `docs/superpowers/mockups/` (with a locked visual-language note); frontend WPs build to it.

### 7.1 Authoring assistant (Cursor-style)
AI assistance for *writing the databank itself* — distinct from cascades, which reconcile code to the databank. It lives in the shared markdown editor and uses `pi-ai` (any provider, incl. Nemotron), with proposed changes always surfaced as **inline diffs** the user accepts or rejects (never silent writes). Three scopes, increasingly wide:

1. **Selection edit** — select text in the editor, ask ("tighten this", "add an acceptance criterion for rate limiting"), and the assistant returns a replacement shown as an inline diff in place. *(MVP — highest value, reuses inline-diff.)*
2. **Document chat** — a side panel scoped to the current doc: ask questions or request edits; edits land as inline diffs.
3. **Wide / multi-doc context** — attach several databank docs (or the whole databank) as context, to reason or edit across requirements at once.

Because the databank is markdown under git, every assistant edit is reviewable and revertible like any other change. This is the natural front-half of the loop: author requirements with AI, then run a cascade to make the code match.

---

## 8. Cross-cutting concerns

- **Reliability / idempotency.** A re-run cascade should converge to the same tree for the same diff; loops are resumable (status persisted in files). Interrupted leaves can be retried with backoff. Re-running a passing loop is a no-op.
- **Failure handling.** A failed leaf → `blocked` subtree → `blocked` root, with the stall point visible. No silent partial "done." Retries are explicit and bounded; persistent failure requires human intervention at the checkpoint or loop page.
- **Observability.** Every state transition is a git commit; the cascade's git log is the audit trail. Live agent output is streamed to the loop page. (Structured logs/metrics for agent runs: Phase 2.)
- **Security.** sloop spawns external agents that modify code and may run tools. MVP mitigations: the human checkpoint before execution; agents run against the working tree under git (every change reviewable/revertible); Security/Pentester roles are first-class so safety review is part of the tree, not an afterthought. Sandboxing/permission policy for executors: Phase 2.
- **Git as substrate.** Cascades operate on branches; approving and converging produces commits. Rollback = git revert of a cascade's commits.

---

## 9. Scope & build sequence (hackathon)

**Demo happy path (the only thing that must work end to end):**
Edit one ADR in the databank → kick off a cascade (pick the `spec-driven` template) → architect loop proposes a small tree → approve at the checkpoint → leaf loops run Pi agents → each leaf's `verify` command runs → statuses bubble up → root flips to **done** → the UI shows "codebase matches databank." That single flow, looking good on screen, IS the demo.

**Build order (each step demoable on its own; stop when the demo lands):**
1. **Files + git over a sample workspace** — Node layer reads/writes loop & ADR markdown (frontmatter parse/serialize), `simple-git` for diff/commit. Seed a sample databank so there's something real to show.
2. **UI shell (Vite/React/Tailwind, Notion look)** — Databank view + Mission Control loop-tree view rendering the markdown files.
3. **Cascade kickoff** — diff the databank, build the architect loop, call the big model to propose the tree (with template), render it + the checkpoint.
4. **Execute leaves** — run a Pi agent per approved leaf (model/provider from the registry), stream output to the loop page, run `verify` commands, set `passed`.
5. **Convergence** — bubble status up; root-done = in sync. This is the money shot — polish it.

**Explicitly cut for the hackathon (do NOT build):**
- Tauri/native packaging (plain localhost web app).
- Hand-built agent runtime or per-provider clients — embed **Pi** (`pi-ai` + `agent`) for both; one `Executor` wraps a Pi agent. Multi-provider (incl. Nebius/Nemotron) comes from Pi, not our code.
- Real file watcher / external-edit sync — refresh on action is fine.
- Retries/backoff, sandboxing, telemetry, multi-user, cost dashboards.
- QA-role adjudication for criteria without a `verify` command — demo only criteria that have one.
- Deep recursion — cap at ~2 levels (architect → leaves, optionally one inner layer) so a demo can't run away.
- Waterfall/TDD templates as polished artifacts — ship `spec-driven` working; the others can be stub markdown that proves the picker exists.

**Post-hackathon (only if it has legs):** everything in the cut list, plus reconciliation against code/external sources and structured ADR IDs hardening.

---

## 10. Open questions

**Resolved:**
- **Diff fidelity** → ADRs carry **stable IDs** per requirement/criterion; the git diff scopes the change and the architect interprets intent. (Hackathon: keep ADRs simple but give criteria stable `id`s.)
- **Acceptance-criteria verification** → primarily a **`verify` shell command** (exit 0 = passed). QA-role adjudication for command-less criteria is Phase 2.

**Still open (don't block the hackathon):**
1. **Concurrency & ordering:** Do sibling loops run fully in parallel, or can the architect/template declare dependencies? (`waterfall` implies sequential — templates may end up encoding this.)
2. **Cascade scope on conflict:** What happens if the databank changes again while a cascade is mid-flight? (Hackathon: assume it doesn't.)

---

## 11. Out of scope (YAGNI for now)

- Cloud/hosted multi-user mode.
- A bespoke coding-agent runtime (we orchestrate existing agents).
- Non-markdown persistence.
- Reconciliation sources other than the doc-vs-doc git diff.
