import { useRef, useState } from 'react';
import { MarkdownEditor, type MarkdownEditorHandle } from '../design/index';
import { SelectionToolbar } from './SelectionToolbar';
import { AssistantPanel, type DocRef } from './AssistantPanel';

export interface AuthoredEditorProps {
  /** Workspace-relative path of the doc being edited (the primary context doc). */
  relPath: string;
  /** Human title for the context chip. */
  title: string;
  /** Markdown body in. */
  value: string;
  /** Edited markdown out (fires on edits and on accepting a proposal). */
  onChange: (markdown: string) => void;
  /** Other databank docs offered for wide multi-doc context. */
  availableDocs?: DocRef[];
  /** Optional model alias override (else backend resolves a default). */
  model?: string;
  /** Show the right-hand assistant panel (doc/multi). Default true. */
  panel?: boolean;
}

/**
 * WP-7 integration component: WP-4's shared `MarkdownEditor` with the Cursor-style author
 * assistant wired in around it — **without editing the editor**. It only uses the editor's
 * exposed hooks (`onSelectionChange`, the `applyProposal` imperative handle) so proposals
 * always surface as inline diffs the user accepts or rejects (never silent writes).
 *
 * Drop-in for the bare `<MarkdownEditor value onChange />` in the Databank ADR view:
 * WP-6 swaps `<MarkdownEditor … />` for `<AuthoredEditor relPath title value onChange … />`.
 */
export function AuthoredEditor({
  relPath,
  title,
  value,
  onChange,
  availableDocs,
  model,
  panel = true,
}: AuthoredEditorProps) {
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [selectionText, setSelectionText] = useState('');

  const applyProposal = (originalText: string, replacement: string) => {
    editorRef.current?.applyProposal(originalText, replacement);
  };

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <SelectionToolbar
          selectionText={selectionText}
          docPaths={[relPath]}
          model={model}
          onProposal={applyProposal}
        />
        <MarkdownEditor
          ref={editorRef}
          value={value}
          onChange={onChange}
          onSelectionChange={setSelectionText}
        />
      </div>
      {panel && (
        <AssistantPanel
          currentDoc={{ relPath, title }}
          currentValue={value}
          availableDocs={availableDocs}
          model={model}
          onProposal={applyProposal}
        />
      )}
    </div>
  );
}
