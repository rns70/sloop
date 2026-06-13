// The sloop design kit (WP-4). Notion-quiet primitives + the shared markdown editor.
// WP-5 imports from here and must not re-style — keep this surface stable.
//
// Components:
//   Page         — routed content area: quiet breadcrumb top bar + body (prose | wide)
//   Tag          — soft-pastel role pill (the one persistent colored element)
//   Button       — quiet button (primary | subtle | ghost)
//   Label        — small uppercase section label
//   Card         — light hairline container (use sparingly; prefer divided rows)
//   PropertyRow  — Notion-style label / value metadata row
//   StatusDot    — status label with a single colored dot
//   MarkdownEditor — the shared BlockNote editor (edit / inline-diff / proposal modes)
//   InlineDiffView — in-document add/remove diff renderer (used by MarkdownEditor)
//
// Helpers:
//   cx, roleTone, statusMeta, diffLines, hasChanges
export { Page } from './Page';
export type { PageProps } from './Page';
export { Tag } from './Tag';
export type { TagProps } from './Tag';
export { Button, IconButton } from './Button';
export type { ButtonProps, IconButtonProps } from './Button';
export { CriteriaWarning } from './CriteriaWarning';
export { Label } from './Label';
export type { LabelProps } from './Label';
export { Card } from './Card';
export type { CardProps } from './Card';
export { PropertyRow } from './PropertyRow';
export type { PropertyRowProps } from './PropertyRow';
export { StatusDot } from './StatusDot';
export type { StatusDotProps } from './StatusDot';
export { EditableTitle } from './EditableTitle';
export type { EditableTitleProps } from './EditableTitle';
export { MarkdownEditor } from './MarkdownEditor';
export type {
  MarkdownEditorProps,
  MarkdownEditorHandle,
  Proposal,
} from './MarkdownEditor';
export { InlineDiffView } from './InlineDiffView';
export type { InlineDiffViewProps } from './InlineDiffView';

export { cx } from './cx';
export { roleTone, statusMeta, TONE_CLASS } from './tokens';
export type { Tone, StatusMeta } from './tokens';
export { diffLines, hasChanges } from './diff';
export type { DiffLine, DiffOp } from './diff';
