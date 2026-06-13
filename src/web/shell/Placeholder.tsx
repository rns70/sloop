import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getCascade, type CascadeDetail } from '../api-client/index';
import { Page, StatusDot } from '../design/index';

/** A quiet placeholder for a surface WP-5 owns but hasn't merged yet. */
export function Placeholder({ section }: { section: string }) {
  return (
    <Page breadcrumb={section}>
      <div className="max-w-prose">
        <h1 className="text-[23px] font-bold tracking-[-0.01em]">{section}</h1>
        <p className="mt-2 text-[13.5px] text-ink-faint">
          This surface is built in WP-5 (Mission Control / Loop / Libraries). The shell and
          routing are in place — drop the view here.
        </p>
      </div>
    </Page>
  );
}

/**
 * Placeholder for a single cascade. WP-5 replaces this with Mission Control, but it
 * already loads and shows the real summary so the "kick off cascade" flow resolves to
 * something concrete.
 */
export function CascadePlaceholder() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<CascadeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    getCascade(id)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  return (
    <Page breadcrumb={`Cascades / ${id}`}>
      <div className="max-w-prose">
        {error && <p className="text-[13px] text-status-failed">{error}</p>}
        {!error && !detail && <p className="text-[13px] text-ink-faint">Loading cascade…</p>}
        {detail && (
          <>
            <div className="flex items-center gap-3">
              <h1 className="text-[23px] font-bold tracking-[-0.01em]">Cascade</h1>
              <StatusDot status={detail.summary.status} />
            </div>
            <p className="mt-2 text-[13.5px] text-ink-muted">
              Template <span className="font-medium text-ink">{detail.summary.template}</span> ·{' '}
              {detail.loops.length} loops · +{detail.summary.deltas.add} ~
              {detail.summary.deltas.change} −{detail.summary.deltas.delete}
            </p>
            <p className="mt-6 text-[13px] text-ink-faint">
              Mission Control (the loop tree + live agent output) renders here in WP-5.
            </p>
          </>
        )}
      </div>
    </Page>
  );
}
