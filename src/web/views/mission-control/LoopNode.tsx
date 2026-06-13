// One loop in the cascade tree. Renders its row (role tag · model·delta · status) and,
// when expanded, its inline criteria + live agent output, then recurses into children.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LoopDoc } from '../../api-client/index';
import { IconButton, StatusDot, Tag, cx, roleTone } from '../../design/index';
import { OutputStream } from '../loop/OutputStream';
import { loopTitle } from './text';

const ACTIVE = new Set(['executing', 'review']);

// One indentation column. 24px wide; the rail sits at its horizontal centre (12px)
// so elbows and pass-throughs from every depth line up vertically.
function RailCell({ line }: { line: boolean }) {
  return (
    <span className="relative w-6 shrink-0 self-stretch" aria-hidden>
      {line && <span className="absolute bottom-0 left-3 top-0 w-px bg-line-soft" />}
    </span>
  );
}

// The connector that joins a node to its parent: a rounded "└"/"├" reaching from the
// rail centre across to the row content, plus a downward continuation when the node
// has younger siblings.
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

export interface LoopNodeProps {
  loop: LoopDoc;
  cascadeId: string;
  roleLabel: (roleId: string) => string;
  getChildren: (loopId: string) => LoopDoc[];
  outputOf: (loopId: string) => string;
  depth?: number;
  /** Pass-through rails for strict ancestors (true = that ancestor has more siblings below). */
  ancestors?: boolean[];
  /** Whether this node is the last among its siblings (controls elbow shape). */
  isLast?: boolean;
}

export function LoopNode({
  loop,
  cascadeId,
  roleLabel,
  getChildren,
  outputOf,
  depth = 0,
  ancestors = [],
  isLast = true,
}: LoopNodeProps) {
  const fm = loop.frontmatter;
  const isArchitect = fm.kind === 'architect';
  const isRoot = depth === 0;
  const children = getChildren(fm.id);
  const criteria = fm.acceptanceCriteria ?? [];
  const passed = criteria.filter((cr) => cr.passed).length;
  const output = outputOf(fm.id);
  const active = ACTIVE.has(fm.status);
  const muted = fm.status === 'queued' || fm.status === 'planned';

  const hasDisclosure = children.length > 0 || criteria.length > 0 || output.length > 0;
  const [open, setOpen] = useState(isArchitect);

  // Auto-expand a leaf while it is working so its output is visible as it streams.
  useEffect(() => {
    if (active || output.length > 0) setOpen(true);
  }, [active, output.length]);

  const metaText = fm.delta ? `${fm.model} · ${fm.delta}` : fm.model;

  let statusDetail = '';
  if (isArchitect && fm.status !== 'done' && children.length > 0) {
    statusDetail = `${children.length} loop${children.length === 1 ? '' : 's'}`;
  } else if (criteria.length > 0 && (fm.status === 'done' || fm.status === 'review')) {
    statusDetail = `${passed}/${criteria.length} criteria`;
  }

  // Rails to draw left of this node's content. Strict-ancestor pass-throughs followed
  // by this node's own elbow (root has no incoming connector). Children and inline
  // content inherit `childRails` so the vertical lines stay continuous between rows.
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

          {isArchitect && <span className="text-[13px] text-role-purple">◆</span>}

          <Link
            to={`/cascades/${encodeURIComponent(cascadeId)}/loops/${encodeURIComponent(fm.id)}`}
            className={cx(
              'text-[14px] hover:underline',
              isArchitect && 'font-semibold',
              muted ? 'text-ink-muted' : 'text-ink',
            )}
          >
            {loopTitle(fm.id, loop.body, cascadeId)}
          </Link>

          <Tag tone={roleTone(fm.role)}>{roleLabel(fm.role)}</Tag>
          <span className="text-[11.5px] text-ink-faint">{metaText}</span>

          <span className="ml-auto flex items-center gap-1.5">
            <StatusDot status={fm.status} />
            {statusDetail && (
              <span className="text-[11.5px] text-ink-faint">· {statusDetail}</span>
            )}
          </span>
        </div>
      </div>

      {open && hasDisclosure && (
        <>
          {criteria.length > 0 && (
            <div className="flex items-stretch">
              <Gutter lines={innerRails} />
              <div className="my-1 flex-1 space-y-1 py-0.5 pr-1 text-[12.5px]">
                {criteria.map((cr) => (
                  <div key={cr.id} className="flex items-baseline gap-2">
                    <span className={cr.passed ? 'text-status-done' : 'text-ink-subtle'}>
                      {cr.passed ? '✓' : '○'}
                    </span>
                    <span className="text-ink-muted">{cr.text}</span>
                    {cr.verify && (
                      <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-ink-faint">
                        {cr.verify}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(output.length > 0 || active) && (
            <div className="flex items-stretch">
              <Gutter lines={innerRails} />
              <div className="my-2.5 flex-1 pr-1">
                <OutputStream text={output} emptyHint="Queued — output will stream here." />
              </div>
            </div>
          )}

          {children.map((child, i) => (
            <LoopNode
              key={child.frontmatter.id}
              loop={child}
              cascadeId={cascadeId}
              roleLabel={roleLabel}
              getChildren={getChildren}
              outputOf={outputOf}
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
