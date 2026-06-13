// A single loop rendered as a Notion page: frontmatter → properties, body → plan,
// streamed agent output below. Reads live state from the shared cascade context.

import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LoopStatus } from '../../api-client/index';
import { PropertyRow, StatusDot, Tag, roleTone } from '../../design/index';
import { Page } from '../../design/index';
import { useCascade } from '../mission-control/CascadeContext';
import { humanizeCascade, loopTitle } from '../mission-control/text';
import { useRoleLabel } from '../mission-control/useRoleLabel';
import { OutputStream } from './OutputStream';

/** plan ✓ → execute ● → review — derived from status (spec §5 loop state machine). */
function StageLine({ status }: { status: LoopStatus }) {
  const order: LoopStatus[] = ['queued', 'executing', 'review', 'done'];
  const rank = order.indexOf(status === 'planned' ? 'queued' : status);
  const stage = (label: string, atRank: number): ReactNode => {
    if (status === 'done' || rank > atRank)
      return <span className="text-status-done">{label} ✓</span>;
    if (rank === atRank) return <span className="text-accent">{label} ●</span>;
    return <span className="text-ink-subtle">{label}</span>;
  };
  return (
    <span>
      {stage('plan', 0)} <span className="text-ink-subtle">→</span> {stage('execute', 1)}{' '}
      <span className="text-ink-subtle">→</span> {stage('review', 2)}
    </span>
  );
}

/** Drop the leading markdown H1 so the page heading isn't duplicated in the body. */
function stripHeading(body: string): string {
  return body.replace(/^\s*#+\s.*(\r?\n)+/, '').trim();
}

export function LoopPage() {
  const { loopId = '' } = useParams();
  const { id, detail, error, loopById, outputs } = useCascade();
  const roleLabel = useRoleLabel();
  const name = humanizeCascade(id);
  const current = loopById(loopId);

  const breadcrumb = (
    <span>
      <Link to={`/cascades/${encodeURIComponent(id)}`} className="hover:underline">
        {name}
      </Link>{' '}
      / {current ? loopTitle(loopId, current.body, id) : loopId}
    </span>
  );

  if (error) {
    return (
      <Page prose breadcrumb={breadcrumb}>
        <p className="text-[13px] text-status-failed">Failed to load cascade: {error}</p>
      </Page>
    );
  }
  if (!detail) {
    return (
      <Page prose breadcrumb={breadcrumb}>
        <p className="text-[13px] text-ink-faint">Loading…</p>
      </Page>
    );
  }
  if (!current) {
    return (
      <Page prose breadcrumb={breadcrumb}>
        <p className="text-[13px] text-ink-faint">
          Loop <code className="font-mono">{loopId}</code> not found in this cascade.{' '}
          <Link to={`/cascades/${encodeURIComponent(id)}`} className="text-accent hover:underline">
            Back to the tree
          </Link>
          .
        </p>
      </Page>
    );
  }

  const fm = current.frontmatter;
  const criteria = fm.acceptanceCriteria ?? [];
  const passed = criteria.filter((cr) => cr.passed).length;
  const plan = stripHeading(current.body);
  const output = outputs[loopId] ?? '';

  return (
    <Page prose breadcrumb={breadcrumb}>
      <div className="flex items-baseline gap-2.5">
        <h1 className="text-[23px] font-bold tracking-[-0.01em]">
          {loopTitle(loopId, current.body, id)}
        </h1>
        <StatusDot status={fm.status} />
      </div>

      <div className="mt-4">
        <PropertyRow label="Role">
          <Tag tone={roleTone(fm.role)}>{roleLabel(fm.role)}</Tag>
        </PropertyRow>
        <PropertyRow label="Model">
          <span className="text-ink-muted">{fm.model}</span>
        </PropertyRow>
        <PropertyRow label="Status">
          <span className="text-ink-muted">
            {fm.kind === 'leaf' ? <StageLine status={fm.status} /> : statusWord(fm.status)}
          </span>
        </PropertyRow>
        {fm.sourceAdr && (
          <PropertyRow label="Source">
            <span className="text-ink-muted">
              {fm.sourceAdr.toUpperCase()}
              {fm.delta ? ` · ${fm.delta}` : ''}
            </span>
          </PropertyRow>
        )}
        {criteria.length > 0 && (
          <PropertyRow label="Criteria">
            <span className="text-ink-muted">
              {passed} / {criteria.length} passed
            </span>
          </PropertyRow>
        )}
      </div>

      {plan && (
        <section className="mt-6 border-t border-line-hair pt-4">
          <h2 className="mb-1.5 text-[14px] font-semibold">Plan</h2>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-muted">{plan}</p>
        </section>
      )}

      {criteria.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
            Acceptance criteria
          </div>
          <ul className="space-y-1 text-[13.5px]">
            {criteria.map((cr) => (
              <li key={cr.id} className="flex items-baseline gap-2">
                <span className={cr.passed ? 'text-status-done' : 'text-ink-subtle'}>
                  {cr.passed ? '✓' : '○'}
                </span>
                <span className="text-ink-muted">{cr.text}</span>
                {cr.verify && (
                  <span className="ml-auto whitespace-nowrap font-mono text-[11.5px] text-ink-faint">
                    verify: {cr.verify}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
          Agent output
        </div>
        <OutputStream
          text={output}
          emptyHint={
            fm.status === 'planned' || fm.status === 'queued'
              ? 'Not started — approve the cascade to run this loop.'
              : 'Waiting for agent output…'
          }
        />
      </section>
    </Page>
  );
}

function statusWord(status: LoopStatus): string {
  return status.replace(/_/g, ' ');
}
