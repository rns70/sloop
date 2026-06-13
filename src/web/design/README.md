# sloop design kit (WP-4)

Notion-quiet primitives + the shared markdown editor. **WP-5 imports from
`src/web/design` and must not re-style** — the visual language lives here and in
`tailwind.config.ts` (the token source of truth). Keep this surface stable.

## Visual language (locked)

- **Notion-quiet.** Hairline dividers (`border-line-soft` / `divide-line-soft`), not
  bordered cards. Generous whitespace. Light, typographic.
- **Grayscale + one accent.** Warm gray text (`text-ink` / `text-ink-muted` /
  `text-ink-faint` / `text-ink-subtle`); `text-accent` is the single blue. Metadata is
  plain muted text, never a colored pill.
- **Role tag** is the one persistent colored element — `<Tag tone={roleTone(role)}>`.
- **Status** is a dot + label — a single colored dot beside a status word.
- **Inline diffs** render in the document flow (green add / red strikethrough), never a
  side rail.

## Exports (`import { … } from '../design/index'`)

| Export | Purpose |
|--------|---------|
| `Page` | Routed content area: quiet breadcrumb top bar + body (`prose` = constrained editor column, default = wide). No top tabs. |
| `Tag` | Soft-pastel role pill. `tone`: `blue` \| `purple` \| `green` \| `pink` \| `gray`. |
| `Button` | Quiet button. `variant`: `primary` (solid dark) \| `subtle` \| `ghost`. `loading` shows a leading spinner and blocks clicks while an async action is in flight. |
| `Label` | Small uppercase section label. |
| `Card` | Light hairline container (use sparingly; prefer divided rows). |
| `PropertyRow` | Notion-style `label` / value metadata row. |
| `Spinner` | Activity spinner (`sm`/`md`/`lg`). Inherits `currentColor`; spins under motion-safe, pulses under reduced-motion. |
| `Skeleton` | Shimmer placeholder block. Compose several to mirror a layout's shape on load. Decorative (hidden from assistive tech). |
| `MarkdownEditor` | **The shared BlockNote editor.** Edit / inline-diff / proposal modes. File-agnostic — edits any markdown string. |
| `InlineDiffView` | In-document add/remove line diff renderer (used by `MarkdownEditor`). |

### Helpers

`cx(...)` (classNames joiner) · `roleTone(role)` → `Tone` ·
`diffLines(before, after)` / `hasChanges(before, after)`.

## `MarkdownEditor` — the core primitive

```tsx
<MarkdownEditor
  value={body}                       // markdown in
  onChange={setBody}                 // exported markdown out (lossy)
  diffAgainst={previousMarkdown}     // optional: read-only inline-diff mode
  onSelectionChange={(text) => …}    // WP-7 hook
  proposal={{ originalText, replacement }} // WP-7: pending change as inline diff
  onAcceptProposal={…} onRejectProposal={…}
  ref={ref}                          // ref.current.applyProposal(orig, repl)
/>
```

- The markdown export is **lossy**: callers with frontmatter (ADRs, roles) pass only the
  **body** and recombine frontmatter on save (see `views/databank/AdrEditor.tsx`).
- Reused unchanged for role/template files in WP-5 and the author assistant in WP-7 —
  WP-7 integrates via the `onSelectionChange` / `proposal` / `applyProposal` hooks and
  never edits this component.
- BlockNote/Mantine styles are scoped to `.sloop-editor` (`markdown-editor.css`) so they
  don't fight the Tailwind theme elsewhere.
