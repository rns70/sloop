import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAdrs, type AdrDoc } from '../../api-client/index';
import { Label, Page } from '../../design/index';

/** Strip the `databank/` prefix to get the route param (the bare filename). */
function fileOf(relPath: string): string {
  return relPath.replace(/^databank\//, '');
}

/**
 * The Databank index: every ADR as a hairline-divided row (title + criteria count).
 * Each row opens the ADR in the shared markdown editor.
 */
export function DatabankList() {
  const [adrs, setAdrs] = useState<AdrDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdrs()
      .then(setAdrs)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <Page breadcrumb="Databank">
      <div className="max-w-prose">
        <h1 className="text-[23px] font-bold tracking-[-0.01em]">Databank</h1>
        <p className="mt-1 text-[13.5px] text-ink-faint">
          Requirement ADRs — the source of truth the codebase is reconciled to.
        </p>

        {error && (
          <p className="mt-6 rounded-md border border-line bg-diff-delBg px-3 py-2 text-[13px] text-diff-delText">
            Failed to reach the API: {error}
          </p>
        )}

        {!error && adrs === null && <p className="mt-6 text-[13px] text-ink-faint">Loading…</p>}

        {adrs && (
          <div className="mt-6">
            <Label className="mb-1 px-1">{adrs.length} entries</Label>
            <div className="divide-y divide-line-soft border-t border-line-soft">
              {adrs.map((adr) => (
                <Link
                  key={adr.id}
                  to={`/databank/${encodeURIComponent(fileOf(adr.relPath))}`}
                  className="flex items-baseline gap-3 px-1 py-2.5 transition-colors hover:bg-line-soft"
                >
                  <span className="text-[14.5px] text-ink">{adr.title}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-ink-faint">
                    {adr.id} · {adr.acceptanceCriteria.length} criteria
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
