// Builds the ADR run subtree from the flat ADR list (linking by `children` relPaths) and
// renders it from the root ADR down. Adapted from the removed mission-control LoopTree,
// repointed at AdrDoc + live run state. The subtree is the source ADR plus all recursive
// descendants — the same run-set the backend executes as one pass.

import { useMemo } from 'react';
import type { AdrDoc } from '../../api-client/index';
import { AdrRunNode } from './AdrRunNode';
import type { AdrRunState } from './runState';

export interface AdrRunTreeProps {
  /** The full ADR list, used to resolve child relPaths to docs. */
  adrs: AdrDoc[];
  /** The ADR being run (root of the displayed subtree). */
  root: AdrDoc;
  /** Live run state by relPath; undefined for an ADR before its first event. */
  runStateOf: (relPath: string) => AdrRunState | undefined;
}

export function AdrRunTree({ adrs, root, runStateOf }: AdrRunTreeProps) {
  const byRelPath = useMemo(() => {
    const m = new Map<string, AdrDoc>();
    for (const a of adrs) m.set(a.relPath, a);
    return m;
  }, [adrs]);

  // Resolve an ADR's ordered children, guarding against cycles/dupes within a single
  // resolution (the backend owns authoritative cycle detection; this just keeps the UI
  // from recursing infinitely on a malformed `children` list).
  const getChildren = useMemo(() => {
    return (adr: AdrDoc): AdrDoc[] => {
      const seen = new Set<string>();
      const out: AdrDoc[] = [];
      for (const cPath of adr.children) {
        if (seen.has(cPath) || cPath === adr.relPath) continue;
        const child = byRelPath.get(cPath);
        if (!child) continue;
        seen.add(cPath);
        out.push(child);
      }
      return out;
    };
  }, [byRelPath]);

  return <AdrRunNode adr={root} getChildren={getChildren} runStateOf={runStateOf} />;
}
