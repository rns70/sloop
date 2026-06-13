import { useEffect, useState } from 'react';
import { getAdrs, type AdrDoc } from './api-client/index';

// Blank Notion-style shell for WP-0. Its only job is to prove the mock works end to
// end: fetch ADRs through the api-client and render them. WP-4 replaces this with the
// real shell + Databank view; WP-5 adds Mission Control / Loop / Libraries.
export default function App() {
  const [adrs, setAdrs] = useState<AdrDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdrs()
      .then(setAdrs)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="min-h-screen bg-white text-ink font-sans">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-ink-muted">sloop</p>
        <h1 className="mt-1 text-3xl font-semibold">Databank</h1>

        {error && (
          <p className="mt-8 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to reach the API: {error}
          </p>
        )}

        {!error && adrs === null && <p className="mt-8 text-ink-muted">Loading…</p>}

        {adrs && (
          <>
            <p className="mt-8 text-ink-muted">
              {adrs.length} ADR{adrs.length === 1 ? '' : 's'} loaded from the mock.
            </p>
            <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
              {adrs.map((adr) => (
                <li key={adr.id} className="px-4 py-3">
                  <span className="font-medium">{adr.title}</span>
                  <span className="ml-2 text-sm text-ink-muted">
                    {adr.id} · {adr.acceptanceCriteria.length} criteria
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
