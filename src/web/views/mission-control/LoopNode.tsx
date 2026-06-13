// One loop in the cascade tree. Renders its row (role tag · model·delta · status) and,
// when expanded, its inline criteria + live agent output, then recurses into children.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LoopDoc } from '../../api-client/index';
import { StatusDot, Tag, cx, roleTone } from '../../design/index';
import { OutputStream } from '../loop/OutputStream';
import { loopTitle } from './text';

const ACTIVE = new Set(['executing', 'review']);

export interface LoopNodeProps {
  loop: LoopDoc;
  cascadeId: string;
  roleLabel: (roleId: string) => string;
  getChildren: (loopId: string) => LoopDoc[];
  outputOf: (loopId: string) => string;
  depth?: number;
}

export function LoopNode({
  loop,
  cascadeId,
  roleLabel,
  getChildren,
  outputOf,
  depth = 0,
}: LoopNodeProps) {
  const fm = loop.frontmatter;
  const isArchitect = fm.kind === 'architect';
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

  return (
    <div className="border-b border-line-soft">
      <div className="flex items-center gap-2.5 rounded-md px-1 py-2 transition-colors hover:bg-line-soft">
        <button
          type="button"
          onClick={() => hasDisclosure && setOpen((o) => !o)}
          className={cx(
            'w-3.5 shrink-0 select-none text-[11px] text-ink-subtle',
            hasDisclosure ? 'cursor-pointer' : 'cursor-default opacity-0',
          )}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>

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
          {statusDetail && <span className="text-[11.5px] text-ink-faint">· {statusDetail}</span>}
        </span>
      </div>

      {open && hasDisclosure && (
        <div className={cx('ml-6', children.length === 0 && 'pb-2.5')}>
          {criteria.length > 0 && (
            <div className="my-1 space-y-1 text-[12.5px]">
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
          )}

          {(output.length > 0 || active) && (
            <div className="my-2.5">
              <OutputStream text={output} emptyHint="Queued — output will stream here." />
            </div>
          )}

          {children.map((child) => (
            <LoopNode
              key={child.frontmatter.id}
              loop={child}
              cascadeId={cascadeId}
              roleLabel={roleLabel}
              getChildren={getChildren}
              outputOf={outputOf}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
