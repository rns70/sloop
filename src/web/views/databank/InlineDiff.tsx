import { useEffect, useState } from 'react';
import { getAdrDiff } from '../../api-client/index';
import { InlineDiffView } from '../../design/index';

export interface InlineDiffProps {
  /** Explicit before/after — used by the editor's "showing changes" mode (edits vs
   *  last accepted). When omitted, `relPath` is used to fetch the committed diff. */
  before?: string;
  after?: string;
  /** Self-fetch the committed loops diff for an ADR via getAdrDiff(relPath). */
  relPath?: string;
}

/**
 * The Databank inline-diff renderer: an added/removed line diff shown in the document
 * flow (green adds / red removes), never a side rail. Either pass `before`/`after`
 * directly, or a `relPath` to load the committed diff from the API.
 */
export function InlineDiff({ before, after, relPath }: InlineDiffProps) {
  const [fetched, setFetched] = useState<{ before: string; after: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const explicit = before !== undefined && after !== undefined;

  useEffect(() => {
    if (explicit || !relPath) return;
    setFetched(null);
    setError(null);
    getAdrDiff(relPath)
      .then(setFetched)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [explicit, relPath]);

  if (error) return <p className="text-[13px] text-status-failed">{error}</p>;

  if (explicit) return <InlineDiffView before={before} after={after} />;
  if (fetched) return <InlineDiffView before={fetched.before} after={fetched.after} />;
  return <p className="text-[13px] text-ink-faint">Loading diff…</p>;
}
