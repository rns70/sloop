# sloop UI mockups (approved)

Reference mockups for the frontend work packages (WP-4, WP-5). Open any `.html` in a browser. Each is a self-contained, inline-styled "app window" — the surrounding heading/option chrome was the brainstorming companion and can be ignored. These define the **visual target**; build to them.

| File | Surface | WP |
|------|---------|----|
| `mission-control-running.html` | Mission Control — cascade running (loop tree, inline agent output) | WP-5 |
| `cascade-done.html` | Mission Control — converged "money shot" (✓ codebase matches databank) | WP-5 |
| `markdown-editor-and-roles.html` | Databank ADR as a plain markdown file with **inline diffs**; role instructions in the **same shared editor** | WP-4 (editor), WP-5 (roles) |
| `loop-page-and-libraries.html` | Loop page (properties + plan + agent output) and Libraries lists | WP-5 |

> Note: `loop-page-and-libraries.html` also contains an early Databank panel with a right-side diff *rail* — that approach was **superseded**. The Databank editor uses **in-document inline diffs** as shown in `markdown-editor-and-roles.html`.

## Locked visual language

- **Notion-quiet.** Hairline row dividers (`#f3f2f0`), not bordered cards. Generous whitespace. Light, typographic.
- **Grayscale + one accent.** Warm grays for text (`#37352f` primary, `#787774`/`#9b9a97` secondary, `#b4b3af` faint). Metadata like model/delta is plain muted text (`sonnet · change`), never a colored pill.
- **Role tag** is the one persistent colored element — a small soft pastel pill (Engineer=blue, Architect=purple, QA=green, Security=pink).
- **Status** is a small label with a single dot: running = blue `●`, done = green, blocked/failed = red, queued/planned = faint gray.
- **Shared markdown editor (BlockNote)** is the core; inline-diff mode shows adds (green, left accent) / removes (red strikethrough) **in the document flow**.
- **Success state** is calm, not gaudy: one soft green banner ("Codebase matches the databank") + a merge action. No confetti.
- **Navigation is the left sidebar only** (Databank · Cascades · Libraries). No top tabs — the content top bar is a quiet breadcrumb.
- The **cascade view** is the only surface with bespoke components; everything else is the shared editor over a markdown file.
