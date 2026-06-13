import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getAdr, getAdrs, getAdrDiff, putAdr, type AdrDoc } from '../../api-client/index';
import { Button, EditableTitle, Page, cx } from '../../design/index';
import { AuthoredEditor } from '../../author/AuthoredEditor';
import type { DocRef } from '../../author/AssistantPanel';
import { InlineDiff } from './InlineDiff';

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
  const relPath = `databank/${file}`;
  const [searchParams] = useSearchParams();
  const isNew = searchParams.get('new') === '1';

  const [adr, setAdr] = useState<AdrDoc | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [committed, setCommitted] = useState(''); // last-accepted body (diff baseline)
  const [availableDocs, setAvailableDocs] = useState<DocRef[]>([]); // other ADRs for wide context
  const [mode, setMode] = useState<Mode>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAdr(null);
    setError(null);
    setMode('edit');
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
    // Offer the other databank ADRs as wide multi-doc context for the assistant.
    getAdrs()
      .then((docs) => {
        if (cancelled) return;
        setAvailableDocs(
          docs
            .filter((d) => d.relPath !== relPath)
            .map((d) => ({ relPath: d.relPath, title: d.title })),
        );
      })
      .catch(() => !cancelled && setAvailableDocs([]));
    return () => {
      cancelled = true;
    };
  }, [relPath]);

  const dirty = adr !== null && (body !== adr.body || title !== adr.title);

  async function save() {
    if (!adr) return;
    setSaving(true);
    setError(null);
    try {
      // The body carries the criteria section; the server re-parses it on write.
      const next: AdrDoc = { ...adr, title, body };
      await putAdr(relPath, next);
      setAdr(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

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
      breadcrumb={<span className="font-mono text-[12px]">Databank / {file}</span>}
      actions={
        adr && (
          <>
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

          {mode === 'edit' ? (
            <AuthoredEditor
              relPath={relPath}
              title={title}
              value={body}
              onChange={setBody}
              availableDocs={availableDocs}
            />
          ) : (
            <InlineDiff before={committed} after={body} />
          )}

        </>
      )}
    </Page>
  );
}
