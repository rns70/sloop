import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './markdown-editor.css';
import { Button } from './Button';
import { InlineDiffView } from './InlineDiffView';

/** A pending Cursor-style edit: replace `originalText` with `replacement`. */
export interface Proposal {
  originalText: string;
  replacement: string;
}

/** Imperative surface exposed to WP-7 (author assistant) so it never edits this file. */
export interface MarkdownEditorHandle {
  /** Show a pending change as an inline diff awaiting accept/reject. */
  applyProposal(originalText: string, replacement: string): void;
}

export interface MarkdownEditorProps {
  /** Markdown in. */
  value: string;
  /** Called with exported markdown on every edit (and on accepting a proposal). */
  onChange?: (markdown: string) => void;
  /** When set, render a read-only inline diff of `diffAgainst` → `value` (no editing). */
  diffAgainst?: string;
  /** Force read-only without diffing. */
  readOnly?: boolean;
  /** WP-7 hook: fires with the current selected text as the user selects. */
  onSelectionChange?: (selectedText: string) => void;
  /** WP-7 hook: a controlled pending proposal (alternative to the imperative handle). */
  proposal?: Proposal | null;
  onAcceptProposal?: () => void;
  onRejectProposal?: () => void;
}

/** Apply a proposal to the current text: replace the first occurrence, or append if absent. */
function applyProposalText(value: string, p: Proposal): string {
  if (p.originalText && value.includes(p.originalText)) {
    return value.replace(p.originalText, p.replacement);
  }
  return value.endsWith('\n') ? value + p.replacement : `${value}\n${p.replacement}`;
}

/**
 * The shared markdown editor for sloop — a BlockNote (block-based rich text) wrapper,
 * not a textarea. It edits whatever markdown string it is given (ADR bodies, role
 * files, workflows), so it is deliberately file-agnostic; callers strip/recombine
 * their own frontmatter (markdown export is lossy).
 *
 * Three render modes:
 *  - **edit** (default): live BlockNote editing.
 *  - **diff** (`diffAgainst` set): read-only inline diff in the document flow.
 *  - **proposal** (`proposal` prop or `applyProposal()`): inline diff of the pending
 *    change with accept/reject — the integration point for WP-7's author assistant.
 */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value,
      onChange,
      diffAgainst,
      readOnly = false,
      onSelectionChange,
      proposal = null,
      onAcceptProposal,
      onRejectProposal,
    },
    ref,
  ) {
    const editor = useCreateBlockNote();
    // The last markdown this component emitted — used to avoid reloading (and losing
    // the cursor) when an external `value` change merely echoes our own edit.
    const lastEmitted = useRef<string | null>(null);
    const [pending, setPending] = useState<Proposal | null>(proposal);

    useImperativeHandle(
      ref,
      () => ({
        applyProposal(originalText, replacement) {
          setPending({ originalText, replacement });
        },
      }),
      [],
    );

    // Keep the controlled `proposal` prop in sync with internal pending state.
    useEffect(() => {
      setPending(proposal);
    }, [proposal]);

    // Load markdown → blocks whenever the external value changes (but not when the
    // change originated from our own export).
    useEffect(() => {
      if (value === lastEmitted.current) return;
      const blocks = editor.tryParseMarkdownToBlocks(value);
      editor.replaceBlocks(editor.document, blocks);
      lastEmitted.current = value;
    }, [editor, value]);

    // Emit markdown on every edit.
    useEffect(() => {
      return editor.onChange(() => {
        const md = editor.blocksToMarkdownLossy(editor.document).trim();
        lastEmitted.current = md;
        onChange?.(md);
      });
    }, [editor, onChange]);

    // Surface selection changes for the author assistant (WP-7).
    useEffect(() => {
      if (!onSelectionChange) return;
      return editor.onSelectionChange(() => {
        onSelectionChange(editor.getSelectedText());
      });
    }, [editor, onSelectionChange]);

    // --- Proposal mode: pending Cursor-style edit awaiting accept/reject. ---
    if (pending) {
      const after = applyProposalText(value, pending);
      return (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-accent">
              Proposed change
            </span>
            <span className="ml-auto flex gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  onChange?.(after);
                  lastEmitted.current = null; // force a reload of the new value
                  onAcceptProposal?.();
                  setPending(null);
                }}
              >
                Accept
              </Button>
              <Button
                variant="subtle"
                onClick={() => {
                  onRejectProposal?.();
                  setPending(null);
                }}
              >
                Reject
              </Button>
            </span>
          </div>
          <InlineDiffView before={value} after={after} />
        </div>
      );
    }

    // --- Diff mode: read-only inline diff against a previous version. ---
    if (diffAgainst !== undefined) {
      return <InlineDiffView before={diffAgainst} after={value} />;
    }

    // --- Edit mode. ---
    return (
      <div className="sloop-editor">
        <BlockNoteView editor={editor} editable={!readOnly} theme="light" />
      </div>
    );
  },
);
