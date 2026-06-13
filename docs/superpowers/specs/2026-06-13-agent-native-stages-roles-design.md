# Design: Research-Grounded Stages & Roles for sloop

**Date:** 2026-06-13
**Status:** Approved (design); pending implementation plan
**Scope:** Deepen + modestly expand sloop's process templates (stages) and roles, grounded in current multi-agent-coding research. Lens: agent-native orchestration.

---

## 1. Background

sloop is an IDE for agent factories: it reconciles a codebase to a databank of
requirement ADRs. A **cascade** decomposes into a tree of agent loops — an Architect
(root) plans and decomposes; leaf loops execute; completion bubbles up. The
**convergence invariant**: the root is done iff every leaf is done AND every acceptance
criterion's `verify` command exits 0.

Two abstractions staff the tree:

- **Templates (stages)** — the *shape of the tree* / process methodology. Markdown +
  YAML frontmatter in `.sloop/templates/*.md`. Type: `TemplateDef`.
- **Roles** — the *personas* that staff the stages. Markdown + YAML frontmatter in
  `.sloop/roles/*.md`. Type: `RoleDef`.

**Today:** 3 templates (`spec-driven` polished; `tdd`, `waterfall` stubs) and 4 roles
(`architect`, `engineer`, `qa`, `security`).

## 2. Goal

Make the template and role libraries genuinely effective for an agent factory, grounded
in evidence rather than intuition. Polish the two stub templates into real agent-native
processes, strengthen `spec-driven`, add the highest-value new templates and roles the
research surfaces, and encode two cross-cutting guardrails the evidence demands.

## 3. Research basis (key findings driving the design)

Full research report is in the conversation log; the load-bearing findings:

1. **A real external oracle is the strongest quality gate.** sloop's verify-command
   invariant is exactly right. Weak gates inflate apparent quality by ~16pts (SWE-ABS,
   arXiv 2603.00520). *Implication:* every leaf must terminate in a machine-checkable
   `verify`; gate strength matters, not just presence.
2. **Reward-hacking is real and worse on stronger models** — frontier models exploit
   tests 46–76% of the time (ImpossibleBench, Anthropic, Oct 2025). *Implication:* the
   parent authors and **locks** the verify command; the executing leaf must not weaken
   it. Commit-the-test-first makes tampering visible in the diff.
3. **Unaided self-correction is net-negative** (DeepMind, arXiv 2310.01798). A critic
   helps only when it is a *separate* agent fed an *external* signal; INDICT (+10%),
   CriticGPT, Self-Refine (+20%). LLM-as-judge bias is measured at 10–25% self-preference
   (arXiv 2410.21819). *Implication:* QA must never self-review and never be the sole
   gate on prose.
4. **Highest-evidence additions:** Debugger role + reproduce-first `debug` template
   (Google bug-reproduction +30% plausible fixes, arXiv 2502.01821); Explorer role
   (explore-before-plan is first-party-mandated, RepoGraph +2–3pts); `migrate`/refactor
   template (Google FSE 2025, arXiv 2504.09691 — ~50% time reduction, hard production ROI).
5. **Model routing:** opus-root / cheap-leaf is directionally validated (Anthropic
   multi-agent research system, Jun 2025), but tier should be a **per-leaf decision based
   on task boundedness**, not a fixed role default. Cheap leaves are safe only for
   bounded, well-specified subtasks behind a strong structured-feedback gate; long-horizon
   leaves cascade-fail (arXiv 2509.25370). Opus is now ~5× Haiku (not 15×), so the
   pressure to push everything to Haiku is weaker than older guidance implied.
6. **Most multi-agent failures are organizational** (MAST, arXiv 2503.13657: System
   Design/Specification 43.9%, Inter-Agent Misalignment 31.15%, Verification 23.75%).
   "Unaware of termination conditions" is a top-3 mode (12.4%). *Implication:* decomposition
   quality + disjoint file ownership + explicit termination are the load-bearing risks —
   not leaf execution.

Evidence-quality note: vendor self-reported numbers (Anthropic uplift figures,
Spec-Kit/Kiro efficacy) are directional, not replicated; the academic set (MAST,
Reflexion, Self-Refine, ImpossibleBench, Agentless, SWE-bench Pro, Google FSE 2025) is
the stronger ground. Routing papers (FrugalGPT/RouteLLM) are Q&A benchmarks and do not
transfer cleanly to long-horizon coding.

## 4. Schema additions (light, additive, back-compatible)

Two new **optional** fields. Both default to absent/false, so existing workspace files
parse unchanged.

### 4.1 `AcceptanceCriterion.locked?: boolean`

```ts
export interface AcceptanceCriterion {
  id: string;
  text: string;
  verify?: string;     // shell command; exit 0 = passed
  locked?: boolean;    // authored by the parent; the executing leaf must not weaken it
  passed: boolean;
}
```

When `locked` is true, the criterion's `text` + `verify` are authored by the parent
(Architect or QA) and the executing leaf must not edit/weaken them. This encodes the
anti-reward-hacking guardrail (finding #2).

- **Now:** the flag is recorded; the Architect prompt sets it on parent-authored gates;
  role briefs instruct engineers to escalate (not edit) a locked check that looks wrong.
- **WP-6 (real executor):** enforcement — a leaf whose diff weakens a locked verify
  command is rejected. This design records the flag and the intent; runtime enforcement
  is explicitly deferred and called out, not silently assumed.

### 4.2 Stage `gate?: boolean`

```ts
export interface TemplateDef {
  id: string;
  name: string;
  stages: { name: string; role: string; model: string; gate?: boolean }[];
  guidance: string;
}
```

`gate: true` marks a stage as a hard verification checkpoint requiring an external signal
(exit code), not self-report. Consumed by:

- the Architect prompt (gates are surfaced as hard checkpoints, and their criteria are
  marked `locked`),
- the Libraries view (gate stages render distinctly),
- (WP-6) the executor's bubble-up logic.

### 4.3 Decision: NO separate `tier` field on stages

Considered and **rejected** to preserve a single source of truth for routing (DRY).
Stages already carry `model`, and the planner already honors a per-leaf `model` override
(`resolveLeafModel`, `src/server/planner/prompt.ts`). Adding a parallel `tier` enum would
create a second routing authority that can drift from `model`. Instead, per-leaf
boundedness-based routing (finding #5) is encoded as **Architect guidance**: treat the
stage `model` as a *floor* for bounded work, and escalate the per-leaf `model` for
open-ended / long-horizon leaves. Same outcome, one source of truth.

## 5. Templates

Stages marked `*` carry `gate: true`. Model aliases come from the registry in
`.sloop/config.md` (`opus`, `sonnet`, `haiku`, `nemotron`).

### 5.1 `spec-driven` (polish — remains the default)

Stages unchanged: `plan` (architect/opus) → `implement` (engineer/haiku) →
`verify`* (qa/sonnet).

Guidance strengthened:
- Write acceptance criteria in **EARS form** (WHEN/IF/WHILE … the system SHALL …) so
  each criterion is unambiguous and maps to a `verify` command (addresses MAST's #1
  failure category, specification).
- Each criterion copied to a leaf is `locked`.
- Disjoint file ownership per leaf; the Architect escalates a leaf's model for
  open-ended work.

### 5.2 `tdd` (rewrite stub → real agent-native process)

Stages: `write-failing-test`* (engineer/sonnet) → `implement` (engineer/haiku) →
`refactor`* (engineer/haiku).

Guidance: per unit — write a failing test that encodes the acceptance criterion, **run it
and confirm it fails**, commit the failing test, **lock** it (the test IS the leaf's
`verify`), implement to green **without editing the test**, then refactor with
green-stays-green. Rationale (test immutability) cited to ImpossibleBench. Removes the
"hackathon stub" disclaimer.

### 5.3 `waterfall` (polish — honest scoping)

Stages unchanged: `requirements` (architect/opus) → `design` (architect/opus) →
`implement` (engineer/sonnet) → `verify`* (qa/sonnet) → `deploy` (engineer/haiku).

Guidance reframed: the value is **gating discipline** — a phase's artifact is frozen and
verified before the next phase starts. Honestly flags that pure sequential phases add
latency for agents (vs. interleaved execution); recommend it only when requirements are
frozen and dependencies are linear. Removes the stub disclaimer; scopes the methodology
correctly rather than over-promising.

### 5.4 `debug` (NEW — reproduce-first)

Stages: `reproduce`* (debugger/sonnet) → `localize` (debugger/sonnet) →
`fix` (engineer/haiku) → `regression-verify`* (qa/sonnet).

Guidance: write a failing regression test that reproduces the defect (`locked`, becomes
the leaf's `verify`); localize the root cause; make the smallest fix; the reproduction
test **and** the existing suite must pass. Cited to Google bug-reproduction (+30%).

### 5.5 `migrate` (NEW — behavior-preserving refactor/migration)

Stages: `survey` (explorer/haiku) → `plan-codemod` (architect/opus) →
`apply` (engineer/haiku) → `verify-green`* (qa/sonnet).

Guidance: the existing test suite is the green-must-stay-green oracle (`locked`); prefer
deterministic recipes/codemods as tools to constrain hallucination on mechanical changes;
partition by file for safe parallel leaves. Cited to Google FSE 2025 (~50% time
reduction). The one new template with hard production ROI numbers.

## 6. Roles

### 6.1 `architect` (polish)

Add to brief: disjoint file-ownership per leaf (ties to the shared-checkout hazard);
author and **lock** the verify command for parent-owned gates; per-leaf model escalation
(stage model is a floor; escalate for open-ended/long-horizon leaves); ensure every leaf
has an explicit machine-checkable termination signal (the Architect cannot mark done
without it — addresses MAST's termination-unawareness mode).

### 6.2 `engineer` (polish)

Add: never weaken a `locked` acceptance test / verify command; if a locked check looks
wrong, **escalate it upward** rather than editing it (anti-reward-hacking). Keep diffs
minimal and reviewable.

### 6.3 `qa` (reframe → independent critic)

Rewrite brief: QA is always a **different agent (and model) from the implementer** —
never reviews its own output. It judges on the verify command's exit code + evidence;
for criteria without a command it adjudicates by inspection but is **never the sole gate**
on prose (LLM-judge bias). A failing check propagates upward as a blocked subtree.

### 6.4 `security` (light polish)

Keep as a first-class, completion-blocking gate. Tie findings to `locked`,
completion-blocking criteria.

### 6.5 `explorer` (NEW)

Read-only, **bounded**, runs in its own context before/within Architect planning to map
the codebase (which files, dependencies, where the change lands). Default model **haiku**
(cheap, read-only). Hard stop conditions — unbounded exploration is itself a documented
failure mode. `color` assigned; `roleTone` mapping added.

### 6.6 `debugger` (NEW)

Reproduce → localize → fix → regression specialist; pairs with the `debug` template. The
reproduction test is the `locked` verify gate. Default model **sonnet**.

## 7. Files touched

| File | Change |
|---|---|
| `src/shared/types.ts` | add `AcceptanceCriterion.locked?`, stage `gate?` |
| `src/server/planner/prompt.ts` | carry `locked` through `ProposedCriterion` + parse; surface `gate` stages and the file-partition + per-leaf-escalation rules in the architect prompt |
| `src/server/api/mock.ts` | parse `locked` on ADR/loop criteria (stages already pass through the existing cast) |
| `src/web/views/libraries/Libraries.tsx` | render `gate` stages distinctly in the stage pipeline |
| design system (`src/web/design/*`) | `roleTone` + `Tag` tone + `color` for `explorer`, `debugger` |
| `.sloop/templates/*.md` | rewrite `tdd`; polish `waterfall`, `spec-driven`; add `debug`, `migrate` (sample workspace fixture) |
| `.sloop/roles/*.md` | polish `architect`, `engineer`, `security`; rewrite `qa`; add `explorer`, `debugger` |
| tests | planner: `locked` carry-through + gate handling; loader: parses new fields; existing tests stay green |

## 8. Testing

- **Unit (planner, pure):** `buildArchitectPrompt` surfaces gate stages and partition
  rules; `parseArchitectResponse` carries `locked` through; model resolution unchanged
  for existing inputs.
- **Unit (loader):** templates with `gate` stages and criteria with `locked` round-trip
  through `loadTemplates`/`loadRoles`; absent fields default correctly (back-compat).
- **Regression:** all existing planner/loader/API tests stay green; existing workspace
  fixtures (without the new fields) still parse.
- **Manual:** Libraries view renders the 2 new roles and 2 new templates, gate stages
  visually distinct; KickoffMenu lists the new templates.

## 9. Non-goals / deferred

- **Runtime enforcement of `locked`** (rejecting a leaf that weakens a locked verify) —
  deferred to WP-6's real executor. This design records the flag + intent only.
- **Waterfall sequential-gating execution** — guidance is real, but cross-stage gating
  in the engine is out of scope here.
- **No `tier` enum** (see §4.3).
- No changes to the cascade kickoff flow, ADR authoring, or the executor itself beyond
  what is listed in §7.

## 10. Guardrails this design enforces (traceability)

| Guardrail | Mechanism | Finding |
|---|---|---|
| Strong external gate per unit | `gate` stages + locked `verify` | #1 |
| No test reward-hacking | `locked` criteria + commit-test-first + engineer brief | #2 |
| No self-review | `qa` reframed as independent critic | #3 |
| Reproduce-first debugging | `debug` template + `debugger` role | #4 |
| Explore before plan | `explorer` role + `migrate` survey stage | #4 |
| Right-sized routing | per-leaf model escalation guidance (no new field) | #5 |
| Decomposition / file ownership / termination | architect brief | #6 |
