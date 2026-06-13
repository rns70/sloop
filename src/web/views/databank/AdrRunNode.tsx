// One ADR in the run subtree. Adapted from the (now-removed) mission-control LoopNode,
// repointed at AdrDoc + live run state instead of LoopDoc. Renders its row (title · live
// status) and, when expanded, its acceptance criteria with live eval results and the
// streamed agent output, then recurses into child ADRs. Visual language preserved.

import { useEffect, useState } from 'react';
import type { AdrDoc } from '../../api-client/index';
import { cx, IconButton } from '../../design/index';
import { OutputStream } from '../loop/OutputStream';
import { adrStatusMeta, isActiveStatus } from './adrStatus';
import { adrTitle } from './text';
import type { AdrRunState } from './runState';

// One indentation column. 24px wide; the rail sits at its horizontal centre (12px) so
// elbows and pass-throughs from every depth line up vertically.
function RailCell({ line }: { line: boolean }) {
  return (
    <span className="relative w-6 shrink-0 self-stretch" aria-hidden>
      {line && <span className="absolute bottom-0 left-3 top-0 w-px bg-line-soft" />}
    </span>
  );
}

// The connector that joins a node to its parent: a rounded "└"/"├" reaching from the
// rail centre across to the row content, plus a downward continuation when the node has
// younger siblings.
function ElbowCell({ last }: { last: boolean }) {
  return (
    <span className="relative w-6 shrink-0 self-stretch" aria-hidden>
      <span className="absolute bottom-1/2 left-3 right-0 top-0 rounded-bl-[6px] border-b border-l border-line-soft" />
      {!last && <span className="absolute bottom-0 left-3 top-1/2 w-px bg-line-soft" />}
    </span>
  );
}

function Gutter({ lines }: { lines: boolean[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <RailCell key={i} line={line} />
      ))}
    </>
  );
}

export interface AdrRunNodeProps {
  adr: AdrDoc;
  /** Resolve a child ADR's id to its doc (and the ordered child list). */
  getChildren: (adr: AdrDoc) => AdrDoc[];
  /** Live run state for an ADR by relPath (undefined before its first event). */
  runStateOf: (relPath: string) => AdrRunState | undefined;
  depth?: number;
  /** Pass-through rails for strict ancestors (true = that ancestor has more siblings below). */
  ancestors?: boolean[];
  /** Whether this node is the last among its siblings (controls elbow shape). */
  isLast?: boolean;
}

export function AdrRunNode({
  adr,
  getChildren,
  runStateOf,
  depth = 0,
  ancestors = [],
  isLast = true,
}: AdrRunNodeProps) {
  const isRoot = depth === 0;
  const children = getChildren(adr);
  const live = runStateOf(adr.relPath);
  // Live status wins once a run is underway; otherwise fall back to the stored status.
  const status = live?.status ?? adr.status;
  const output = live?.output ?? '';
  const evalResults = live?.criteria ?? {};
  const criteria = adr.acceptanceCriteria ?? [];
  const active = isActiveStatus(status);
  const { label, dotClass } = adrStatusMeta(status);

  const passed = criteria.filter((cr) => evalResults[cr.id] ?? cr.passed).length;

  const hasDisclosure = children.length > 0 || criteria.length > 0 || output.length > 0;
  const [open, setOpen] = useState(isRoot);

  // Auto-expand while working so output streams into view.
  useEffect(() => {
    if (active || output.length > 0) setOpen(true);
  }, [active, output.length]);

  let statusDetail = '';
  if (criteria.length > 0 && (status === 'passed' || status === 'failed' || status === 'evaluating')) {
    statusDetail = `${passed}/${criteria.length} criteria`;
  } else if (children.length > 0) {
    statusDetail = `${children.length} ADR${children.length === 1 ? '' : 's'}`;
  }

  // Rails to draw left of this node's content. Strict-ancestor pass-throughs then this
  // node's own elbow (root has none). Children/inline content inherit `childRails`.
  const childRails = isRoot ? [] : [...ancestors, !isLast];
  const innerRails = isRoot ? [children.length > 0] : [...childRails, children.length > 0];

  return (
    <div className="border-b border-line-soft">
      <div className="flex items-stretch px-1 transition-colors hover:bg-line-soft">
        {!isRoot && <Gutter lines={ancestors} />}
        {!isRoot && <ElbowCell last={isLast} />}

        <div className="flex flex-1 items-center gap-2.5 py-2">
          <IconButton
            size="sm"
            variant="ghost"
            onClick={() => hasDisclosure && setOpen((o) => !o)}
            className={cx(
              'select-none text-[11px] text-ink-subtle',
              !hasDisclosure && 'pointer-events-none opacity-0',
            )}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </IconButton>

          <span className={cx('text-[14px]', isRoot ? 'font-semibold text-ink' : 'text-ink')}>
            {adrTitle(adr.id, adr.title, adr.body)}
          </span>
          <span className="font-mono text-[11px] text-ink-faint">{adr.id}</span>

          <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span className={cx('text-[8px] leading-none', dotClass)} aria-hidden>
              ●
            </span>
            <span>{label}</span>
            {statusDetail && <span className="text-[11.5px] text-ink-faint">· {statusDetail}</span>}
          </span>
        </div>
      </div>

      {open && hasDisclosure && (
        <>
          {criteria.length > 0 && (
            <div className="flex items-stretch">
              <Gutter lines={innerRails} />
              <div className="my-1 flex-1 space-y-1 py-0.5 pr-1 text-[12.5px]">
                {criteria.map((cr) => {
                  const ok = evalResults[cr.id] ?? cr.passed;
                  return (
                    <div key={cr.id} className="flex items-baseline gap-2">
                      <span className={ok ? 'text-status-done' : 'text-ink-subtle'}>
                        {ok ? '✓' : '○'}
                      </span>
                      <span className="text-ink-muted">{cr.text}</span>
                      {cr.verify && (
                        <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-ink-faint">
                          {cr.verify}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(output.length > 0 || active) && (
            <div className="flex items-stretch">
              <Gutter lines={innerRails} />
              <div className="my-2.5 flex-1 pr-1">
                <OutputStream text={output} emptyHint="Working — output will stream here." />
              </div>
            </div>
          )}

          {children.map((child, i) => (
            <AdrRunNode
              key={child.id}
              adr={child}
              getChildren={getChildren}
              runStateOf={runStateOf}
              depth={depth + 1}
              ancestors={childRails}
              isLast={i === children.length - 1}
            />
          ))}
        </>
      )}
    </div>
  );
}
