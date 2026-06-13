# Product

## Register

product

## Users

Engineers and technical operators running "agent factories": they kick off cascades
(trees of agent loops) that reconcile a codebase to a databank of requirement ADRs, then
supervise the run, approve the proposed plan at a human checkpoint, and watch loops
execute and converge. Their context is an IDE-like cockpit, focused and keyboard-driven,
where they read plans, edit loops before they run, and monitor streaming agent output.

## Product Purpose

sloop is an IDE for agent factories. It keeps a codebase continuously reconciled to a
databank of requirement ADRs by planning the work as a cascade (an architect loop and its
child work loops), gating execution behind a human approval checkpoint, and streaming each
loop's progress live. Success is the operator trusting the system enough to approve and
run, then seeing the root loop flip to "done" with criteria passed: the convergence
"money shot."

## Brand Personality

Notion-quiet, precise, calm. Three words: restrained, legible, trustworthy. The interface
should feel like a focused document tool, not a dashboard: hairline dividers instead of
bordered cards, warm grays with a single blue accent, generous whitespace, typographic
hierarchy. Feedback (loading, running, done) is communicated through small, honest
signals (a status dot, a spinner, a skeleton that matches the real layout), never through
spectacle. Motion is subtle and purposeful, and always respects reduced-motion.

## Anti-references

- Loud SaaS dashboards: gradient hero metrics, neon accents, card grids everywhere.
- Heavy "enterprise console" chrome: dense toolbars, bordered panels, drop shadows on
  everything.
- Flashy spinners/progress theatrics. Loading should reassure quietly, not perform.

## Design Principles

- **Honest state.** Every async action shows its real state: loading screens mirror the
  layout they replace, in-flight actions show a spinner on the control that triggered them.
- **One accent.** Grayscale carries structure; the single blue marks the one thing that
  matters on screen (the active/running signal).
- **Quiet by default, legible always.** Restraint never costs readability: body contrast
  stays high, hit areas stay tappable.
- **The design kit is the source of truth.** Shared primitives live in `src/web/design`
  (tokens in `tailwind.config.ts`); views compose them and never re-style.

## Accessibility & Inclusion

Target WCAG 2.1 AA. Body text meets ≥4.5:1 contrast; interactive controls clear the 24px
hit-area floor. All motion (spinner rotation, skeleton shimmer) has a
`prefers-reduced-motion` alternative (pulse / suppressed sweep). Loading screens expose a
polite live region with a text status for screen readers; purely decorative placeholders
are hidden from assistive tech.
