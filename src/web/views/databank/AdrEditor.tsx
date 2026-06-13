import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAdr, getAdrDiff, putAdr, type AdrDoc } from '../../api-client/index';
import { Button, MarkdownEditor, Page, cx } from '../../design/index';
import { InlineDiff } from './InlineDiff';

type Mode = 'edit' | 'changes';

/**
 * Opens one ADR (a plain markdown file) in the shared editor. The frontmatter and
 * acceptance criteria are structured data shown alongside; the editor edits only the
 * markdown *body* (export is lossy), and Save recombines the edited body with the
 * untouched rest of the document.
 */
export function AdrEditor() {
  const { file = '' } = useParams();
  const relPath = `databank/${file}`;

  const [adr, setAdr] = useState<AdrDoc | null>(null);
  const [body, setBody] = useState('');
  const [committed, setCommitted] = useState(''); // last-accepted body (diff baseline)
  const [mode, setMode] = useState<Mode>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAdr(null);
    setError(null);
    setMode('edit');
    Promise.all([getAdr(relPath), getAdrDiff(relPath)])
      .then(([doc, diff]) => {
        if (cancelled) return;
        setAdr(doc);
        setBody(doc.body);
        setCommitted(diff.before);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [relPath]);

  const dirty = adr !== null && body !== adr.body;

  async function save() {
    if (!adr) return;
    setSaving(true);
    setError(null);
    try {
      // Recombine: only the body changed; frontmatter + criteria are passed through.
      const next: AdrDoc = { ...adr, body };
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
            'flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] transition-colors',
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
          <div className="mb-1 font-mono text-[12px] text-ink-faint">{file}</div>
          <div className="mb-5 text-[13px] text-ink-faint">
            Markdown on disk · inline diff vs last accepted commit
          </div>

          {mode === 'edit' ? (
            <MarkdownEditor value={body} onChange={setBody} />
          ) : (
            <InlineDiff before={committed} after={body} />
          )}

          <AcceptanceCriteria adr={adr} />
        </>
      )}
    </Page>
  );
}

function AcceptanceCriteria({ adr }: { adr: AdrDoc }) {
  if (adr.acceptanceCriteria.length === 0) return null;
  return (
    <section className="mt-9 border-t border-line-soft pt-5">
      <h2 className="text-[15px] font-semibold">Acceptance criteria</h2>
      <ul className="mt-3 space-y-2.5">
        {adr.acceptanceCriteria.map((c) => (
          <li key={c.id} className="text-[13.5px] leading-relaxed">
            <div className="flex items-baseline gap-2">
              <code className="rounded bg-line-soft px-1.5 py-0.5 font-mono text-[12px] text-ink-muted">
                {c.id}
              </code>
              <span className="text-ink">{c.text}</span>
            </div>
            {c.verify && (
              <div className="ml-1 mt-1 font-mono text-[12px] text-ink-faint">
                verify: {c.verify}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
