# Acceptance criteria format

Acceptance criteria live in the **markdown body** of ADR (`databank/*.md`) and loop
(`cascades/*/*.md`) files, under a `## Acceptance criteria` heading, one criterion per
line:

````markdown
## Acceptance criteria

- [ ] **ac-1** Refresh tokens rotate on every use. — verify: `npm test -- rotation` 🔒
- [x] **ac-2** Old tokens are rejected after rotation.
````

| Marker | Meaning |
|---|---|
| `- [ ]` / `- [x]` | not passed / passed (case-insensitive) |
| `**ac-N**` | stable criterion id (survives reorder/edit) |
| `— verify: \`cmd\`` | optional shell command (exit 0 = passed). Must not contain a backtick. |
| trailing 🔒 | optional: locked (authored by a parent; a leaf must not weaken it) |
| remaining text | the criterion text |

## How it is produced

Do not hand-format this section in code. The serializer in
`src/server/files/criteriaMarkdown.ts` (`upsertCriteriaInBody`) is the single source of
truth — it renders criteria into this format and assigns missing ids (`ac-N`). All write
paths (the file service for ADRs and loops, and the mock backend's loaders) route through
it, so agents and code produce structured `AcceptanceCriterion[]` and never write the
markdown by hand.

## Read/write model

- **ADRs** are body-authoritative: a human edits the body in the editor, and the server
  parses criteria from the body on save.
- **Loops** are field-authoritative: the cascade engine mutates the structured
  `acceptanceCriteria` field (e.g. flipping `passed`), and the server serializes it back
  into the body.
- Legacy files that still carry `acceptanceCriteria:` in frontmatter are read with a
  fallback and migrate to the body on the next write.
