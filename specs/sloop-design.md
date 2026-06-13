# Sloop Design Spec

Date: 2026-06-13

## Purpose

Sloop is a meta-IDE for defining and running nested agent loops. It lets users define agent workflows as Markdown-based documents and loop contracts, then use agents to generate, evaluate, update, and cascade work across a hierarchy of documents and implementation tasks.

## Decisions

### Product Shape

- Sloop is paper-first: the main surface is a Notion-like block editor over canonical Markdown.
- The UI should stay minimal, simple, and document-like.
- Primary loop state should not be presented as dashboard cards or a permanent inspector panel.
- Loop status, running child loops, evaluation results, and pause/resume controls should live as a quiet footer/status section at the bottom of the document.
- Diffs should be inline near the changed document content, using document-native change marks rather than framed review cards.
- A strong full diff viewer is still a core part of the product for expanded review.
- A history drawer shows cascade runs, agent runs, eval results, commits, pauses/resumes, archived alternatives, and rollback points.
- A minimap or graph should not be shown by default.
- A graph view and agent-console view may be added later, but they are not the primary first surface.
- The saved design reference is `specs/design-inspiration/minimal-document-experience.html`.

### Technical Stack

- The hackathon version will use TypeScript and Vite.
- It will use a local Node worker/server for filesystem access, Git operations, and agent orchestration.
- Tauri and Rust are deferred for now.

### Source Of Truth

- Markdown files are the canonical source of truth.
- Frontmatter may be used for structured metadata.
- Any database or index is derived state and must be rebuildable from Markdown files and Git history.

### Loop And Document Model

- Loop definitions, loop docs, generated docs, and maintained docs are Markdown-based.
- A loop doc can define lower stages inline.
- Lower stages can themselves define further lower stages, creating arbitrary nested pipelines from day one.
- The `PRD -> architecture docs -> implementation plans -> build agents` flow is only an example/template, not a hardcoded product structure.
- A loop may fan out into multiple alternatives, evaluate them, select a winner, and continue cascading only from the selected path.
- Losing alternatives remain visible as archived/collapsible docs or runs for provenance.

### Evaluation

- Every loop must have strict evaluation criteria.
- Evaluation criteria are defined canonically as text in Markdown.
- Implementation agents may derive deterministic checks from the textual criteria, such as tests, lint commands, fixtures, schemas, or replay cases.
- Passing evaluation gates is required before auto-application of agent changes.

### Cascading Changes

- Changing any part of any loop doc cascades to lower loops.
- Cascades should update only the specifically affected downstream features.
- Sloop will not require stable hidden block IDs in Markdown.
- Agents inspect Git diffs, current downstream docs, loop definitions, and evaluation criteria to determine precise downstream changes.

### Run Behavior

- Cascaded changes are auto-applied once evaluation passes.
- Users can pause any loop at any time.
- While a loop is paused, users can edit its underlying Markdown document manually.
- Resuming or re-evaluating a paused loop cascades the relevant changes downward again.
- In any loop doc, users must be able to see whether that loop or any child loop is running.
- Clicking a child loop/status opens the corresponding underlying loop doc.

### Git

- Sloop uses Git intensively for diffs, provenance, rollback, review, and auditability.
- Each agent run happens in its own temporary Git worktree/branch.
- Agent changes are merged or applied back into the main workspace only after passing evaluation.

### Agent Execution

- Sloop runs agents through a single Pi runtime adapter.
- The Pi adapter invokes the Pi coding agent CLI from isolated Git worktrees.
- Pi's agent runtime is provided by the Pi agent core package.
- Sloop uses Pi only; alternate Codex, Claude, or other runtime adapters are out of scope for the hackathon runtime.
- Pi is expected to be installed globally and authenticated before Sloop runs agent loops.
- Recommended setup is `pi /login`, or interactive `pi` followed by `/login`.
- The adapter reads `SLOOP_PI_COMMAND`, defaulting to `pi`.
- The adapter reads `SLOOP_PI_MODEL`, defaulting to `openai-codex/gpt-5.3-codex`.
- `SLOOP_PI_PROVIDER` is optional and only affects Pi invocation when set.
- `SLOOP_PI_ARGS` is optional extra CLI arguments appended to the Pi invocation.
- `SLOOP_PI_SESSION_ROOT` optionally overrides the root for per-run Pi session directories.
- Each Pi run gets its own session directory under `.sloop/pi-sessions`.
- Agents may edit loop definition Markdown files directly when instructed.

## Open Design Sections

- Application components and UI layout.
- Markdown/frontmatter shape for loop docs.
- Local Node worker responsibilities and APIs.
- Git/worktree lifecycle.
- Cascade and evaluation state machine.
- Error handling and recovery.
- Testing strategy.
