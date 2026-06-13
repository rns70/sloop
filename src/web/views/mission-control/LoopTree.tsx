// Builds the loop forest from the flat list (linking by `children`/`parent`) and
// renders it from the root loop down.

import { useMemo } from 'react';
import type { LoopDoc } from '../../api-client/index';
import { LoopNode } from './LoopNode';

export interface LoopTreeProps {
  loops: LoopDoc[];
  rootLoopId: string;
  cascadeId: string;
  roleLabel: (roleId: string) => string;
  outputs: Record<string, string>;
}

export function LoopTree({ loops, rootLoopId, cascadeId, roleLabel, outputs }: LoopTreeProps) {
  const byId = useMemo(() => {
    const m = new Map<string, LoopDoc>();
    for (const l of loops) m.set(l.frontmatter.id, l);
    return m;
  }, [loops]);

  const getChildren = useMemo(() => {
    return (loopId: string): LoopDoc[] => {
      const parent = byId.get(loopId);
      const ordered =
        parent?.frontmatter.children
          ?.map((cid) => byId.get(cid))
          .filter((l): l is LoopDoc => Boolean(l)) ?? [];
      // Union with any loops that point here via `parent` but weren't listed.
      const seen = new Set(ordered.map((l) => l.frontmatter.id));
      for (const l of loops) {
        if (l.frontmatter.parent === loopId && !seen.has(l.frontmatter.id)) ordered.push(l);
      }
      return ordered;
    };
  }, [byId, loops]);

  const root = byId.get(rootLoopId) ?? loops.find((l) => !l.frontmatter.parent);
  if (!root) return null;

  return (
    <LoopNode
      loop={root}
      cascadeId={cascadeId}
      roleLabel={roleLabel}
      getChildren={getChildren}
      outputOf={(id) => outputs[id] ?? ''}
    />
  );
}
