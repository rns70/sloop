// WP-7 author assistant — web side. Cursor-style editing of databank docs layered over
// WP-4's shared MarkdownEditor (via its exposed hooks; the editor itself is never edited).
//
// Integration: WP-6 swaps the bare `<MarkdownEditor value onChange />` in the Databank ADR
// view for `<AuthoredEditor relPath title value onChange availableDocs />`.
export { AuthoredEditor, type AuthoredEditorProps } from './AuthoredEditor';
export { SelectionToolbar, type SelectionToolbarProps } from './SelectionToolbar';
export { AssistantPanel, type AssistantPanelProps, type DocRef } from './AssistantPanel';
export { useAuthor, type UseAuthor } from './useAuthor';
