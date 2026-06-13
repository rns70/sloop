// Visual treatment for an ADR run status. Mirrors the design-kit `statusMeta` (which is
// typed to LoopStatus) but for the ADR lifecycle, keeping the same locked dot palette.

import type { AdrStatus } from '../../api-client/index';

export interface AdrStatusMeta {
  label: string;
  /** Tailwind text-color class for the dot. */
  dotClass: string;
}

export function adrStatusMeta(status: AdrStatus): AdrStatusMeta {
  switch (status) {
    case 'running':
      return { label: 'running', dotClass: 'text-status-running' };
    case 'evaluating':
      return { label: 'evaluating', dotClass: 'text-status-running' };
    case 'passed':
      return { label: 'passed', dotClass: 'text-status-done' };
    case 'failed':
      return { label: 'failed', dotClass: 'text-status-failed' };
    case 'idle':
    default:
      return { label: 'idle', dotClass: 'text-status-queued' };
  }
}

/** Whether a status represents an in-flight (non-terminal) run state. */
export function isActiveStatus(status: AdrStatus): boolean {
  return status === 'running' || status === 'evaluating';
}
