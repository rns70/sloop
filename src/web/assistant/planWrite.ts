import type { AdrDoc, AssistantProposal } from '../api-client/index';
import { slugify, uniqueSlug } from '../shell/createItem';

/** What the rail should do once the user confirms a proposal. */
export type WritePlan =
  | { kind: 'answer'; text: string }
  | { kind: 'edit'; relPath: string; content: string }
  | { kind: 'create-adr'; relPath: string; doc: AdrDoc }
  | { kind: 'create-file'; relPath: string; content: string; libKind: 'roles' | 'templates' };

export interface ExistingIds { adrPaths: string[]; roleIds: string[]; templateIds: string[]; }

/** basename without extension, e.g. 'databank/x/auth.md' -> 'auth'. */
function baseId(path: string | undefined): string {
  if (!path) return '';
  return (path.split('/').pop() ?? '').replace(/\.md$/, '');
}

/**
 * Turn a typed proposal into a concrete, collision-safe write plan. The model proposes a
 * path/slug; this guarantees uniqueness against what already exists so a create never
 * silently clobbers a file. Slug helpers are shared with the sidebar's create flow
 * (see `../shell/createItem`) so both paths uniquify identically.
 */
export function planWrite(p: AssistantProposal, existing: ExistingIds): WritePlan {
  if (p.action === 'answer') return { kind: 'answer', text: p.content };
  if (p.action === 'edit') return { kind: 'edit', relPath: p.targetPath ?? '', content: p.content };

  if (p.action === 'create-adr') {
    const base = baseId(p.targetPath) || slugify(p.title ?? 'untitled');
    const id = uniqueSlug(base, new Set(existing.adrPaths.map(baseId)));
    const relPath = `databank/${id}.md`;
    return { kind: 'create-adr', relPath, doc: { id, relPath, title: p.title ?? 'Untitled', body: p.content, acceptanceCriteria: [] } };
  }

  const libKind: 'roles' | 'templates' = p.action === 'create-role' ? 'roles' : 'templates';
  const base = baseId(p.targetPath) || slugify(p.summary || libKind);
  const id = uniqueSlug(base, new Set(libKind === 'roles' ? existing.roleIds : existing.templateIds));
  return { kind: 'create-file', relPath: `.sloop/${libKind}/${id}.md`, content: p.content, libKind };
}
