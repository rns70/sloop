import { useState, type FormEvent } from 'react';
import { Button, cx } from '../design/index';
import { useAuthor } from './useAuthor';

export interface SelectionToolbarProps {
  /** The text currently selected in the editor (from `MarkdownEditor.onSelectionChange`). */
  selectionText: string;
  /** Docs for context — the current doc first. */
  docPaths: string[];
  /** Optional model alias override. */
  model?: string;
  /**
   * Called with `(originalText, replacement)` when a proposal returns. The parent applies
   * it via `MarkdownEditor.applyProposal`, which renders the inline diff to accept/reject.
   */
  onProposal: (originalText: string, replacement: string) => void;
  className?: string;
}

/**
 * The Cursor-style "ask to change this selection" affordance. Appears only when there is
 * a non-empty selection. The user types an instruction; on submit we ask the backend for
 * a replacement and hand it up as a proposal — never a silent write.
 */
export function SelectionToolbar({
  selectionText,
  docPaths,
  model,
  onProposal,
  className,
}: SelectionToolbarProps) {
  const [instruction, setInstruction] = useState('');
  const { run, loading, error } = useAuthor();

  const selected = selectionText.trim();
  if (!selected) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ask = instruction.trim();
    if (!ask || loading) return;
    try {
      const replacement = await run({
        scope: 'selection',
        instruction: ask,
        docPaths,
        selectionText,
        model,
      });
      onProposal(selectionText, replacement);
      setInstruction('');
    } catch {
      // error surfaced below via the hook's `error`
    }
  }

  return (
    <div
      className={cx(
        'mb-3 rounded-md border border-line-soft bg-paper px-3 py-2 shadow-sm',
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-ink-faint">
        <span className="font-medium uppercase tracking-[0.07em] text-accent">Ask to change</span>
        <span className="truncate font-mono">“{truncate(selected, 60)}”</span>
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex items-center gap-2">
        <input
          type="text"
          autoFocus
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="tighten this · add an acceptance criterion for rate limiting…"
          className="min-w-0 flex-1 rounded border border-line-soft bg-paper px-2 py-1 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <Button variant="primary" disabled={loading || !instruction.trim()}>
          {loading ? 'Asking…' : 'Ask'}
        </Button>
      </form>
      {error && <p className="mt-1.5 text-[12px] text-status-failed">{error}</p>}
    </div>
  );
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}
