# ADR Refining-Brainstorm Skill for the Assistant — Design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)
**Area:** `src/server/assistant`

## Problem

Today the sloop assistant writes ADRs immediately the moment it detects intent
("Writes apply immediately — there is no confirmation step"). For roles, workflows,
small edits, and plain Q&A that is the right, low-friction behavior. But an ADR is a
**requirement** — the convergence contract a whole cascade reconciles against. Writing one
straight from a one-line user prompt produces shallow, under-specified requirements: vague
context, an un-sharpened decision, missing trade-offs, and acceptance criteria that are not
objectively verifiable.

We want the assistant to instead run a **superpowers-style refining brainstorm** when an ADR
is being created or substantially changed: explore the idea collaboratively, one question at
a time, then recap and get a go-ahead before writing.

## Goals

- When the assistant detects intent to **create** or **substantially change** an ADR, it
  enters a refining-brainstorm protocol instead of writing immediately.
- The brainstorm draws out four dimensions: **problem & motivation**, **the decision
  itself**, **consequences/trade-offs**, and **objectively verifiable acceptance criteria**.
- Interaction is strict superpowers style: **one question per turn**, then a **recap gate** —
  the assistant summarizes the proposed ADR and waits for the user's go-ahead before calling
  `create_adr` / `edit_doc`.
- Everything else stays immediate: plain Q&A, role/workflow files, and small/mechanical ADR
  edits (typo, rename a heading, tweak one line) do **not** trigger the protocol.

## Non-Goals

- No new tools, stream events, or UI. The recap gate is conversational, not a UI-enforced
  approval chip. (That was Approach B, explicitly rejected as YAGNI for now.)
- No change to how writes physically apply once approved — `create_adr` / `edit_doc` are
  unchanged.
- Not a sloop "workflow" file (`.sloop/workflows/*.md`). Those are agent-loop workflows
  (steps/roles/models), a different concept. This skill lives in the assistant's own prompt.

## Approach (A — prompt-driven protocol)

The assistant is already a prompt-driven, tool-using agent loop (`agent.ts`). The agent loop
**ends a turn whenever the model emits text without a tool call** and waits for the next user
message. That property is the entire mechanism we need:

- "Ask one question and stop" = emit text, call no tool → turn ends, user replies.
- "Recap and wait for go-ahead" = emit the recap text, call no tool → turn ends.
- "Write once approved" = on the next turn, call `create_adr` / `edit_doc`.

So the feature is **purely a system-prompt addition** in `src/server/assistant/prompt.ts`.
No changes to `agent.ts`, `tools.ts`, or any web code.

### The protocol (added to the system prompt)

A new named block — `ADR_REFINEMENT_PROTOCOL` — exported/composed into the system prompt,
worded roughly as:

> **Refining ADRs.** ADRs are requirements — the contract a cascade reconciles against, so
> they must be sharp. When the user asks you to **create a new ADR** or **substantially
> change** an existing one, do NOT write it immediately. Instead run a refining brainstorm:
>
> 1. If editing an existing ADR, `read_doc` it first.
> 2. Ask **one** clarifying question at a time (never a batch). Work through, as needed:
>    - **Problem & motivation** — why this requirement exists; the real problem and constraints.
>    - **The decision** — the normative requirement; scope boundaries; alternatives rejected.
>    - **Consequences** — trade-offs, impacts, follow-on effects.
>    - **Acceptance criteria** — each must be objectively verifiable; prefer a shell
>      `verify:` command. Push back on vague or unverifiable criteria.
>    Skip a dimension only when the user has already made it unambiguous.
> 3. When you have enough, **recap** the proposed ADR (title + Context / Decision /
>    Consequences / Acceptance criteria) and ask the user to confirm or adjust. Do not write yet.
> 4. Only after the user gives a go-ahead, call `create_adr` (new) or `edit_doc` (existing),
>    following the ADR template. Preserve existing criteria when editing.
>
> This protocol applies ONLY to creating or substantially rewriting an ADR. Plain questions,
> roles, workflows, and small/mechanical ADR edits (fix a typo, reword one line, rename a
> heading) apply immediately as before — do not interrogate the user over a trivial change.

### Reconciling with the existing "apply immediately" rule

`prompt.ts` currently states writes apply immediately with no confirmation. We keep that line
as the default, and scope the new protocol as the explicit exception for ADR
create/substantial-change. Wording must make the boundary unambiguous so the model neither
(a) interrogates the user over a typo fix, nor (b) skips the brainstorm on a real new ADR.

## Components

- **`src/server/assistant/prompt.ts`** — add the `ADR_REFINEMENT_PROTOCOL` constant and
  compose it into `SYSTEM`. Keep it as its own named block (a discrete, named "skill") so it
  is greppable, testable, and extensible. No signature changes to
  `buildAssistantSystemPrompt()`.

That is the only production file that changes.

## Data Flow

Unchanged in shape. Illustrative turn sequence for "create an ADR for rate limiting":

1. User: "Add an ADR for API rate limiting." → model emits a single question
   ("What problem is rate limiting solving here — abuse, cost, fairness?"), no tool call →
   turn ends.
2. User answers → model asks the next single question (decision/scope) → … (consequences) →
   … (criteria, pushing for a `verify:` command).
3. Model emits a recap of the full proposed ADR, asks for go-ahead, no tool call → turn ends.
4. User: "looks good" → model calls `create_adr` with a template-compliant body → write
   applies, rail navigates to the new ADR.

## Error Handling / Edge Cases

- **Trivial edit misclassified as substantial:** mitigated by explicit prompt wording listing
  trivial-edit examples that stay immediate.
- **User says "just write it, don't ask":** the user is in control — an explicit instruction
  to skip the brainstorm overrides the protocol; the model should comply.
- **Model skips the gate (writes without recap):** this is the known soft-gate limitation of
  Approach A — the gate is model discipline, not system-enforced. Accepted trade-off;
  escalation path is Approach B (a `propose_adr` tool + approval chip) if discipline proves
  unreliable in practice.
- **Mid-brainstorm context loss:** no special handling — the chat thread is the state, same
  as every other assistant turn.

## Testing

Unit tests in `src/server/assistant/prompt.test.ts` asserting `buildAssistantSystemPrompt()`
output contains the protocol's invariants (string-level, matching the existing test style):

- Mentions refining/brainstorm for ADRs and "one question at a time" (or equivalent).
- Names all four dimensions: problem/motivation, decision, consequences, verifiable criteria.
- States the recap/confirm-before-writing gate.
- Preserves the existing assertions (`create_adr`, `apply immediately`, the ADR template,
  `## Acceptance criteria`, `verify:`, "objectively verifiable") — the default-immediate rule
  must still be present for non-ADR actions.

No new test files; no `agent.ts` behavioral test needed since the loop mechanics are unchanged
and already covered by `agent.test.ts`.

## Rollback

Single-file, additive prompt change. Rollback = revert the `prompt.ts` edit. No data,
schema, or API surface affected; no feature flag needed.
