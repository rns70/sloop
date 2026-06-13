import { useMemo, useState } from 'react';
import { Button, IconButton, Label, cx } from '../design/index';
import { useAuthor } from './useAuthor';

export interface DocRef {
  relPath: string;
  title: string;
}

export interface AssistantPanelProps {
  /** The doc currently open in the editor (always in context, first docPath). */
  currentDoc: DocRef;
  /** The editor's current markdown body — the `originalText` for a whole-doc edit. */
  currentValue: string;
  /** Other databank docs the user can attach for wide multi-doc context. */
  availableDocs?: DocRef[];
  /** Optional model alias override. */
  model?: string;
  /**
   * Called with `(originalText, replacement)` for an edit result — the parent applies it
   * via `MarkdownEditor.applyProposal` (inline diff, accept/reject). Chat answers are
   * shown in-panel and not applied.
   */
  onProposal: (originalText: string, replacement: string) => void;
  className?: string;
}

/**
 * The quiet right-hand authoring panel (spec §7.1, scopes 2 + 3). Scoped to the current
 * doc by default; attach more databank docs to widen the context (which makes the request
 * `multi`). "Edit" lands as an inline diff; "Ask" returns an answer shown here.
 */
export function AssistantPanel({
  currentDoc,
  currentValue,
  availableDocs = [],
  model,
  onProposal,
  className,
}: AssistantPanelProps) {
  const [attached, setAttached] = useState<DocRef[]>([]);
  const [instruction, setInstruction] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const { run, loading, error } = useAuthor();

  const attachable = useMemo(
    () =>
      availableDocs.filter(
        (d) => d.relPath !== currentDoc.relPath && !attached.some((a) => a.relPath === d.relPath),
      ),
    [availableDocs, currentDoc.relPath, attached],
  );

  const scope: 'doc' | 'multi' = attached.length > 0 ? 'multi' : 'doc';
  const docPaths = [currentDoc.relPath, ...attached.map((d) => d.relPath)];

  async function ask(action: 'edit' | 'chat') {
    const text = instruction.trim();
    if (!text || loading) return;
    setAnswer(null);
    try {
      const proposal = await run({ scope, instruction: text, docPaths, model });
      if (action === 'edit') {
        onProposal(currentValue, proposal);
        setInstruction('');
      } else {
        setAnswer(proposal);
      }
    } catch {
      // surfaced via `error`
    }
  }

  return (
    <aside className={cx('w-72 shrink-0 border-l border-line-soft pl-5 text-[13px]', className)}>
      <Label>Assistant</Label>

      <div className="mb-3 mt-2">
        <div className="mb-1 text-[11px] text-ink-faint">Context</div>
        <div className="flex flex-wrap gap-1.5">
          <Chip label={currentDoc.title} />
          {attached.map((d) => (
            <Chip
              key={d.relPath}
              label={d.title}
              onRemove={() => setAttached((xs) => xs.filter((x) => x.relPath !== d.relPath))}
            />
          ))}
        </div>
        {attachable.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const doc = attachable.find((d) => d.relPath === e.target.value);
              if (doc) setAttached((xs) => [...xs, doc]);
            }}
            className="mt-2 w-full rounded border border-line-soft bg-paper px-2 py-1 text-[12px] text-ink-muted outline-none focus:border-accent"
          >
            <option value="" disabled>
              + add a doc for wider context…
            </option>
            {attachable.map((d) => (
              <option key={d.relPath} value={d.relPath}>
                {d.title}
              </option>
            ))}
          </select>
        )}
      </div>

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={4}
        placeholder={
          scope === 'multi'
            ? 'Reason or edit across these docs…'
            : 'Ask about this doc, or request an edit…'
        }
        className="w-full resize-y rounded border border-line-soft bg-paper px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
      />

      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="primary"
          disabled={loading || !instruction.trim()}
          onClick={() => void ask('edit')}
        >
          {loading ? 'Working…' : 'Edit doc'}
        </Button>
        <Button
          variant="subtle"
          disabled={loading || !instruction.trim()}
          onClick={() => void ask('chat')}
        >
          Ask
        </Button>
      </div>

      {error && <p className="mt-2 text-[12px] text-status-failed">{error}</p>}

      {answer && (
        <div className="mt-3 rounded-md bg-line-soft px-3 py-2">
          <div className="mb-1 text-[11px] uppercase tracking-[0.07em] text-ink-faint">Answer</div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{answer}</p>
        </div>
      )}
    </aside>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-line-soft px-1.5 py-0.5 text-[12px] text-ink-muted">
      {label}
      {onRemove && (
        <IconButton
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove ${label} from context`}
          className="-mr-1 text-ink-faint hover:text-ink"
        >
          ×
        </IconButton>
      )}
    </span>
  );
}
