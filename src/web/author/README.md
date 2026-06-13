# WP-7 — Author assistant (Cursor-style editing of databank docs)

The AI-authoring side of sloop: edit the *requirements*, distinct from cascades
(which reconcile code). Every proposed change is shown as an **inline diff** the user
accepts or rejects — never a silent write. All model calls go through
`@earendil-works/pi-ai`, so any provider (incl. NVIDIA Nemotron) works.

## Pieces

| File | Role |
|------|------|
| `useAuthor.ts` | Typed hook over `POST /api/author` (`run(req) → proposal`, `loading`, `error`). |
| `SelectionToolbar.tsx` | "Ask to change this selection" affordance (scope `selection`). |
| `AssistantPanel.tsx` | Quiet right-hand panel for `doc`/`multi` — context chips + Edit/Ask. |
| `AuthoredEditor.tsx` | **Drop-in** composing the above around WP-4's `MarkdownEditor`. |

The editor (`src/web/design/MarkdownEditor.tsx`, WP-4) is **never edited**. WP-7 uses only
its exposed hooks: `onSelectionChange` (current selection) and the imperative
`applyProposal(originalText, replacement)` handle, which renders the inline diff with
Accept/Reject built in.

## Integrating into the Databank ADR view (WP-6 / WP-4)

In `src/web/views/databank/AdrEditor.tsx`, swap the bare editor:

```diff
- <MarkdownEditor value={body} onChange={setBody} />
+ <AuthoredEditor
+   relPath={relPath}
+   title={file}
+   value={body}
+   onChange={setBody}
+   availableDocs={otherAdrs}   // [{ relPath, title }] from getAdrs(), for multi context
+ />
```

`AuthoredEditor` only renders in `mode === 'edit'`; "Showing changes" keeps WP-4's
`InlineDiff`. `availableDocs` is optional (omit → selection + single-doc only).

## API addition (coordinated with WP-5, who owns `api-client`)

Appended to `src/web/api-client/index.ts` — **added, not rewritten**:

- re-exports the `AuthorRequest` (shared) and `AuthorResponse` (contract) types;
- `requestAuthor(req: AuthorRequest): Promise<AuthorResponse>` → `POST /api/author`.

## Backend (`src/server/author/`)

`createAuthorService({ files, env, call?, defaultModel? })` is the logic behind
`POST /api/author`. WP-6 wires it into the real `SloopApi` in place of the mock's
deterministic `author()` (`src/server/api/mock.ts`):

```ts
const author = createAuthorService({ files: filesService }); // FilesServiceImpl satisfies AuthorFiles
// SloopApi.author(req) => author.author(req)
```

Model alias resolution: `req.model` → `SLOOP_AUTHOR_MODEL` → `sonnet` → first registry
alias. Scopes: `selection` (return only the replacement), `doc` (whole-doc edit or chat
answer), `multi` (same, first docPath is primary, others are context).

## Contract prerequisite (added by WP-7)

`AuthorRequest` did not exist when WP-7 started, so it was added per the build overview:
`src/shared/types.ts` (the `AuthorRequest` interface), `src/server/api/contract.ts`
(`author()` on `SloopApi` + `AuthorResponse`), `src/server/api/mock.ts` (deterministic
stand-in), `src/server/index.ts` (the route), and `api-client` (above).
