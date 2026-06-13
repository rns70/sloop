import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getAdr, getAdrDiff, putAdr, type AdrDoc } from '../../api-client/index';
import { bodyHasNoCriteria, CRITERIA_ASSISTANT_INSTRUCTION } from '../../../shared/index';
import { Button, CriteriaWarning, EditableTitle, MarkdownEditor, Page, cx, type MarkdownEditorHandle } from '../../design/index';
import { signalTouches, useAssistant } from '../../assistant/AssistantContext';
import { useRegisterSave } from '../../shell/EditorActionsContext';
import { InlineDiff } from './InlineDiff';
import { RunPanel } from './RunPanel';

type Mode = 'edit' | 'changes';

/**
 * Opens one ADR (a plain markdown file) in the shared editor. Acceptance criteria
 * live in the markdown *body* (a `## Acceptance criteria` task list) and are edited
 * inline like the rest of the document; the server parses them back into structured
 * criteria on save. The editor passes the edited body straight through.
 */
export function AdrEditor() {
  const params = useParams();
  const file = params['*'] ?? ''; // splat: may include folders, e.g. auth/adr-007.md
  const relPath = `loops/${file}`;
  const [searchParams] = useSearchParams();
  const isNew = searchParams.get('new') === '1';

  const [adr, setAdr] = useState<AdrDoc | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [committed, setCommitted] = useState(''); // last-accepted body (diff baseline)
  const [mode, setMode] = useState<Mode>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const { registerOpenDoc, runAssistant, writeSignal } = useAssistant();

  /** Fetch the ADR body + diff baseline from disk. `fresh` resets the view (Loading…,
   *  back to edit mode) when the path changes; an in-place refresh after an assistant
   *  write keeps the current view and just swaps in the new content. Returns a cleanup
   *  that cancels the in-flight fetch so a stale response can't overwrite newer state. */
  const load = useCallback(
    (fresh: boolean) => {
      let cancelled = false;
      if (fresh) {
        setAdr(null);
        setMode('edit');
      }
      setError(null);
      getAdr(relPath)
        .then((doc) => {
          if (cancelled) return;
          setAdr(doc);
          setTitle(doc.title);
          setBody(doc.body);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
      // The diff is best-effort: a brand-new ADR has no committed baseline yet.
      getAdrDiff(relPath)
        .then((diff) => !cancelled && setCommitted(diff.before))
        .catch(() => !cancelled && setCommitted(''));
      return () => {
        cancelled = true;
      };
    },
    [relPath],
  );

  useEffect(() => load(true), [load]);

  // The "Add with assistant" criteria shortcut runs in the rail and writes this doc to
  // disk via the API (not the inline-diff channel), and the rail's navigate-to-written-
  // path is a no-op when we're already showing it — so without this the editor keeps the
  // pre-write body. Refetch in place when the assistant touches *this* path.
  useEffect(() => {
    if (!signalTouches(writeSignal, relPath)) return;
    return load(false);
  }, [writeSignal, relPath, load]);

  // Register this doc with the global assistant so the rail can use it as context and
  // hand an edit of THIS doc to the editor's inline accept/reject diff (no API write).
  useEffect(() => {
    registerOpenDoc({
      relPath,
      getValue: () => body,
      applyInline: (orig, repl) => editorRef.current?.applyProposal(orig, repl),
    });
    return () => registerOpenDoc(null);
  }, [relPath, body, registerOpenDoc]);

  const dirty = adr !== null && (body !== adr.body || title !== adr.title);
  const missingCriteria = bodyHasNoCriteria(body);

  /** Persist the current buffer. Returns true on success so callers (e.g. the
   *  "Add with assistant" shortcut) can avoid acting on stale on-disk content. */
  async function save(): Promise<boolean> {
    if (!adr) return false;
    setSaving(true);
    setError(null);
    try {
      // The body carries the criteria section; the server re-parses it on write.
      const next: AdrDoc = { ...adr, title, body };
      await putAdr(relPath, next);
      setAdr(next);
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Expose Save to the app-level Cmd+S hotkey and the command palette.
  useRegisterSave(() => void save(), dirty && !saving);

  const toggle = (
    <div className="flex items-center gap-1 rounded-md bg-line-soft p-0.5">
      {(['edit', 'changes'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={cx(
            'flex min-h-6 items-center gap-1.5 rounded px-2 text-[12px] transition-colors',
            mode === m ? 'bg-paper font-medium text-ink shadow-sm' : 'text-ink-muted',
          )}
        >
          {m === 'changes' && (
            <span className="text-[8px] leading-none text-status-running">●</span>
          )}
          {m === 'edit' ? 'Edit' : 'Showing changes'}
        </button>
      ))}
    </div>
  );

  return (
    <Page
      prose
      breadcrumb={<span className="font-mono text-[12px]">Docs / {file}</span>}
      actions={
        adr && (
          <>
            {missingCriteria && <CriteriaWarning variant="badge" />}
            {toggle}
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        )
      }
    >
      {error && <p className="mb-4 text-[13px] text-status-failed">{error}</p>}
      {!error && !adr && <p className="text-[13px] text-ink-faint">Loading…</p>}

      {adr && (
        <>
          <EditableTitle value={title} onChange={setTitle} autoFocus={isNew} />
          <div className="mb-5 mt-1 font-mono text-[12px] text-ink-faint">{file}</div>

          {/* Run controls + the live run tree sit at the TOP, above the document. */}
          <RunPanel key={relPath} adr={adr} onApplied={() => load(false)} />

          {mode === 'edit' && missingCriteria && (
            <CriteriaWarning
              action={
                <Button
                  variant="subtle"
                  onClick={async () => {
                    // Persist the buffer first so the agent edits the latest on-disk
                    // content; skip the assistant if the save failed (error is shown).
                    if (!(await save())) return;
                    runAssistant(`Edit the design file \`${relPath}\`. ${CRITERIA_ASSISTANT_INSTRUCTION}`);
                  }}
                >
                  Add with assistant
                </Button>
              }
            />
          )}

          {mode === 'edit' ? (
            <MarkdownEditor ref={editorRef} value={body} onChange={setBody} />
          ) : (
            <InlineDiff before={committed} after={body} />
          )}
        </>
      )}
    </Page>
  );
}
