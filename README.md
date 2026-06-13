# Sloop

![Sloop concept](assets/sloop-concept.png)

Sloop is a local-first Rust/Tauri meta-IDE for designing, running, and supervising nested agent loops. It feels like a Notion-style paper workspace: users edit loop documents through a polished block editor, while the canonical source of truth remains Markdown, likely with frontmatter for loop type, dependencies, evaluation criteria, and runtime policy.

A Sloop project is a Git-backed document graph. A top-level PRD loop can define requirements and eval criteria; downstream architecture loops generate module docs; implementation-planning loops generate build plans; builder agents then execute from those plans. Every loop is user or agent definable, and every loop must include strict evaluation criteria before its outputs can be accepted.

When a document changes, Sloop uses Git diffs and agent analysis to cascade the change downward through affected child loops only. If evals pass, downstream docs are auto-applied, with Git providing the diff viewer, audit trail, rollback path, and review surface. No hidden stable block IDs are required in the Markdown; agents inspect the actual diff and relevant documents to decide what needs updating.

The UI always shows the live state of a loop and its child loops: running, paused, evaluating, failed, or complete. Clicking a child status opens its underlying loop document. Any loop can be paused, manually edited by the user, and resumed, causing the downstream cascade to run again from that changed point.
