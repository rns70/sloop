// Creating new library/databank items from the sidebar, plus the markdown serializers
// the editors reuse on save. Roles and workflows are written through the raw-file API
// (PUT /api/files), so the frontend owns their on-disk shape: frontmatter + body. ADRs
// go through the structured putAdr, so the backend serializes those.

import { getAdr, putAdr, putFile, type RoleDef, type WorkflowDef } from '../api-client/index';

/** kebab-case a display name into a filename-safe id; never empty. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

/** First of `base`, `base-2`, `base-3`, … not already in `taken`. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const b = slugify(base);
  if (!taken.has(b)) return b;
  for (let i = 2; ; i += 1) {
    const candidate = `${b}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---- Markdown serializers (roles/workflows) --------------------------------
// Minimal, deterministic YAML — only the known fields, escaped conservatively.

const yamlScalar = (v: string): string =>
  /^[\w .,/@-]*$/.test(v) ? v : JSON.stringify(v); // quote anything with YAML-special chars

/** Full role file content (frontmatter + brief body). */
export function serializeRole(meta: Omit<RoleDef, 'brief'>, body: string): string {
  const lines = [
    '---',
    `id: ${meta.id}`,
    `name: ${yamlScalar(meta.name)}`,
    `defaultModel: ${yamlScalar(meta.defaultModel)}`,
  ];
  if (meta.color) lines.push(`color: ${yamlScalar(meta.color)}`);
  lines.push('---', '', body.replace(/^\n+/, ''), '');
  return lines.join('\n');
}

/** Full workflow file content (frontmatter + guidance body). */
export function serializeWorkflow(meta: Omit<WorkflowDef, 'guidance'>, body: string): string {
  const lines = ['---', `id: ${meta.id}`, `name: ${yamlScalar(meta.name)}`, 'steps:'];
  for (const s of meta.steps) {
    lines.push(
      `  - name: ${yamlScalar(s.name)}`,
      `    role: ${yamlScalar(s.role)}`,
      `    model: ${yamlScalar(s.model)}`,
    );
    if (s.gate) lines.push('    gate: true');
  }
  lines.push('---', '', body.replace(/^\n+/, ''), '');
  return lines.join('\n');
}

// ---- Create -----------------------------------------------------------------

const ADR_PLACEHOLDER = 'Describe the requirement this ADR captures.';
const ROLE_PLACEHOLDER = 'Describe what this role does and how it should approach its work.';
const WORKFLOW_PLACEHOLDER =
  'Guidance the architect follows when decomposing work under this workflow.';

/**
 * Create a new ADR, optionally inside a folder (`auth` or `auth/sub`, '' = top level).
 * `existingRelPaths` are the databank relPaths already in the tree (for id uniqueness).
 * Returns the databank-relative subpath to route to (`/databank/<subpath>`).
 */
export async function createDatabankItem(existingRelPaths: string[], folder = ''): Promise<string> {
  const dir = folder ? `databank/${folder}` : 'databank';
  const taken = new Set(
    existingRelPaths
      .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .map((p) => p.slice(dir.length + 1).replace(/\.md$/, '')),
  );
  const id = uniqueSlug('untitled', taken);
  const relPath = `${dir}/${id}.md`;
  await putAdr(relPath, {
    id,
    relPath,
    title: 'Untitled',
    body: `\n${ADR_PLACEHOLDER}\n`,
    acceptanceCriteria: [],
  });
  return relPath.replace(/^databank\//, '');
}

export type LibKind = 'roles' | 'workflows';

/**
 * Create a new role/workflow scaffold. `existingIds` are the ids already present.
 * Returns the new id to route to (`/libraries/<kind>/<id>`).
 */
export async function createLibraryItem(kind: LibKind, existingIds: string[]): Promise<string> {
  const id = uniqueSlug('untitled', new Set(existingIds));
  const relPath = `.sloop/${kind}/${id}.md`;
  const content =
    kind === 'roles'
      ? serializeRole({ id, name: 'Untitled', defaultModel: 'opus' }, ROLE_PLACEHOLDER)
      : serializeWorkflow(
          {
            id,
            name: 'Untitled',
            steps: [
              { name: 'architect', role: 'architect', model: 'opus' },
              { name: 'implement', role: 'engineer', model: 'sonnet' },
            ],
          },
          WORKFLOW_PLACEHOLDER,
        );
  await putFile(relPath, content);
  return id;
}

// ---- Duplicate / rename ------------------------------------------------------

/** The workspace path of a role/workflow file. */
export function libraryFilePath(kind: LibKind, id: string): string {
  return `.sloop/${kind}/${id}.md`;
}

/** Re-serialize a role/workflow from its full typed value (sidebar state already holds it),
 *  so a rename or duplicate is a client-side write — no extra endpoint. */
function serializeLibrary(kind: LibKind, item: RoleDef | WorkflowDef): string {
  if (kind === 'roles') {
    const r = item as RoleDef;
    const meta: Omit<RoleDef, 'brief'> = { id: r.id, name: r.name, defaultModel: r.defaultModel };
    if (r.color) meta.color = r.color;
    return serializeRole(meta, r.brief);
  }
  const w = item as WorkflowDef;
  return serializeWorkflow({ id: w.id, name: w.name, steps: w.steps }, w.guidance);
}

/**
 * Duplicate a databank ADR in place (same folder), copying its body + criteria under a fresh
 * unique id and a "… copy" title. `existingRelPaths` are the databank relPaths already in the
 * tree (for id uniqueness). Returns the databank-relative subpath to route to.
 */
export async function duplicateDatabankItem(
  existingRelPaths: string[],
  srcRelPath: string,
): Promise<string> {
  const src = await getAdr(srcRelPath);
  const sub = srcRelPath.replace(/^databank\//, '');
  const slashIdx = sub.lastIndexOf('/');
  const folder = slashIdx === -1 ? '' : sub.slice(0, slashIdx);
  const dir = folder ? `databank/${folder}` : 'databank';
  const taken = new Set(
    existingRelPaths
      .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .map((p) => p.slice(dir.length + 1).replace(/\.md$/, '')),
  );
  const baseId = sub.slice(slashIdx + 1).replace(/\.md$/, '');
  const id = uniqueSlug(`${baseId}-copy`, taken);
  const relPath = `${dir}/${id}.md`;
  await putAdr(relPath, {
    ...src,
    id,
    relPath,
    title: src.title ? `${src.title} copy` : 'Untitled copy',
  });
  return relPath.replace(/^databank\//, '');
}

/** Duplicate a role/workflow under a fresh unique id + "… copy" name. Returns the new id. */
export async function duplicateLibraryItem(
  kind: LibKind,
  item: RoleDef | WorkflowDef,
  existingIds: string[],
): Promise<string> {
  const id = uniqueSlug(`${item.id}-copy`, new Set(existingIds));
  const copy = { ...item, id, name: `${item.name} copy` };
  await putFile(libraryFilePath(kind, id), serializeLibrary(kind, copy));
  return id;
}

/** Rename a role/workflow by rewriting its `name` frontmatter (id/file path stay stable). */
export async function renameLibraryItem(
  kind: LibKind,
  item: RoleDef | WorkflowDef,
  newName: string,
): Promise<void> {
  await putFile(libraryFilePath(kind, item.id), serializeLibrary(kind, { ...item, name: newName }));
}
