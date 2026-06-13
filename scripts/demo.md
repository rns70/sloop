# sloop demo runbook (WP-6)

The one flow that must look good on screen: **edit an ADR → kick off a cascade →
architect proposes a tree → approve → leaves run → `verify` passes → the root flips to
`done` → "codebase matches databank."** Target: a clean ~90 seconds.

There are three ways to run it, fastest/safest first:

| Mode | Command | Network? | What's real |
|------|---------|----------|-------------|
| **Mock** (guaranteed fallback) | `SLOOP_MOCK=1 npm run dev` | none | nothing — scripted UI from fixtures |
| **Real, dry-run** (recommended for live) | real backend + `SLOOP_DRY_RUN=1` | none | files, git diff, cascade engine, convergence, **real `verify` commands** — only the LLM calls are skipped |
| **Real, full** | real backend + API keys | yes | everything, including Pi agents editing the target repo |

> The convergence invariant is genuinely exercised in **dry-run** — the architect's tree
> is derived from the real databank diff and each leaf's `verify` command really runs in
> the target repo. Use dry-run for the live demo unless you specifically want to show a
> Pi agent writing code.

---

## 0. One-time setup

```bash
npm install

# The databank is the source of desired state, so it must be its own git repo
# (so `git diff` scopes changes to databank/). The sample workspace ships un-inited:
git -C fixtures/sample-workspace init -q
git -C fixtures/sample-workspace add -A
git -C fixtures/sample-workspace -c user.name=sloop -c user.email=sloop@earendil.works \
    commit -q -m "databank baseline"
```

`fixtures/sample-workspace/.git/` is git-ignored by the outer repo, so this stays local.

For **real, full** mode only, copy `.env.example` → `.env` and set `ANTHROPIC_API_KEY`
and/or `NEBIUS_API_KEY` (Nebius hosts NVIDIA Nemotron; it's registered with Pi as an
OpenAI-compatible provider from the registry in `fixtures/sample-workspace/.sloop/config.md`).

---

## 1. Prove it headlessly first (always do this before going live)

```bash
npm run verify:demo
```

This drives the **real backend** (`createRealApi` — the same code the server uses)
through the entire happy path in dry-run, against an isolated temp copy of the
workspace, and asserts the root converges to `done`. Expected tail:

```
▸ Kickoff → cascade 2026-06-13-spec-driven (awaiting_approval); deltas={"add":0,"change":1,"delete":0}
▸ Proposed 2 loop(s): 1 architect + 1 leaf.
[verify] ac-1: npm test -- rotation → PASS
[verify] ac-2: npm test -- reuse-detection → PASS
✅ HAPPY PATH VERIFIED — root is DONE. Codebase matches databank.
```

If that's green, the live demo will work.

---

## 2. Live demo — start the app

Pick the env, then `npm run dev` (one command; runs the API + Vite together).
The web app is at **http://localhost:5173** (Vite proxies `/api` to the backend on 5174).

**Real, dry-run (recommended):**

```bash
SLOOP_DRY_RUN=1 \
SLOOP_TARGET_REPO=$(pwd)/fixtures/sample-target-repo \
SLOOP_MAX_DEPTH=2 \
SLOOP_PLANNER_MODEL=opus \
npm run dev
```

**Mock fallback (if anything is flaky):**

```bash
SLOOP_MOCK=1 npm run dev
```

Confirm the backend mode any time: `curl -s localhost:5174/api/health` →
`{"ok":true,"backend":"real"}` (or `"mock"`).

---

## 3. Click-by-click (the screen flow)

1. **Databank.** Land on the Databank view. Open **ADR-007 — Refresh-token rotation**.
   It has two acceptance criteria, each with a `verify` command.
2. **Edit the ADR.** Change the rotation window — e.g. "within ≤15 minutes" → "≤10
   minutes" (and the matching line in the Decision section). Save. This is the databank
   delta the cascade will reconcile. *(In dry-run the architect derives the tree from
   exactly this diff.)*
3. **Kick off.** Sidebar → **＋ Kick off cascade** → **Spec-driven**. You land on the
   new cascade in **Mission Control**, root loop `awaiting_approval`.
4. **Read the tree.** One architect loop → one engineer leaf carrying ADR-007's two
   criteria. The checkpoint banner shows.
5. **Approve.** Click **Approve**. The leaf goes `queued → executing → review → done`;
   open the **Loop page** to watch the streamed output and each `verify` command's
   PASS land live.
6. **The money shot.** Status bubbles up and the **root flips to `done`** — Mission
   Control shows the cascade converged: *codebase matches databank.*

---

## 4. Reset between runs

```bash
# Discard the demo ADR edit and any generated cascades in the sample workspace:
git -C fixtures/sample-workspace checkout -- databank
git -C fixtures/sample-workspace clean -fdq cascades
```

(Generated cascade folders appear under `fixtures/sample-workspace/cascades/<date>-spec-driven*/`.)

---

## Environment variables (reference)

| Var | Default | Meaning |
|-----|---------|---------|
| `SLOOP_MOCK` | unset | truthy → in-memory mock backend (guaranteed UI, no services) |
| `SLOOP_DRY_RUN` | unset | truthy → real engine, but skip Pi agents (architect + leaf); `verify` still runs |
| `SLOOP_WORKSPACE` | `fixtures/sample-workspace` | the databank/workspace sloop operates on |
| `SLOOP_TARGET_REPO` | `cwd` | repo the executor runs `verify` commands in |
| `SLOOP_PLANNER_MODEL` | template default (`opus`) | architect model alias (real mode) |
| `SLOOP_EXECUTOR_MODEL` | `sonnet` | leaf execution model alias (real, non-dry-run) |
| `SLOOP_MAX_DEPTH` | `2` | hard cap on loop-tree depth (safety) |
| `PORT` / `PORT_WEB` | `5174` / `5173` | backend / web ports |

## Troubleshooting

- **`fatal: not a git repository` / empty diff on kickoff** → run step 0 (init the
  sample workspace) and make an ADR edit before kicking off.
- **Kickoff 500 "Missing API key"** (real, non-dry-run) → set the provider key or use
  `SLOOP_DRY_RUN=1`.
- **Anything flaky on stage** → `SLOOP_MOCK=1 npm run dev` always serves the full UI.
