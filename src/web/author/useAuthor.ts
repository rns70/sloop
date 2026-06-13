import { useCallback, useState } from 'react';
import { requestAuthor, type AuthorRequest } from '../api-client/index';

/**
 * Hook around `POST /api/author` (WP-7). Exposes a single `run(req)` that returns the
 * proposal string, plus `loading`/`error` for the UI. It never mutates the document —
 * callers surface the returned proposal as an inline diff to accept or reject.
 */
export interface UseAuthor {
  run: (req: AuthorRequest) => Promise<string>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export function useAuthor(): UseAuthor {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (req: AuthorRequest): Promise<string> => {
    setLoading(true);
    setError(null);
    try {
      const { proposal } = await requestAuthor(req);
      return proposal;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { run, loading, error, clearError };
}
