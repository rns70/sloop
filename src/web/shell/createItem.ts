// Creating new library/databank items from the sidebar, plus the markdown serializers
// the editors reuse on save. Roles and workflows are written through the raw-file API
// (PUT /api/files), so the frontend owns their on-disk shape: frontmatter + body. ADRs
// go through the structured putAdr, so the backend serializes those.

import { putAdr, putFile, type RoleDef, type WorkflowDef } from '../api-client/index';

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
  }
  lines.push('---', '', body.replace(/^\n+/, ''), '');
  return lines.join('\n');
}

// ---- Create -----------------------------------------------------------------

const ADR_PLACEHOLDER = 'Describe the requirement this ADR captures.';
const ROLE_PLACEHOLDER = 'Describe what this role does and how it should approach its work.';
const TEMPLATE_PLACEHOLDER =
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
          TEMPLATE_PLACEHOLDER,
        );
  await putFile(relPath, content);
  return id;
}
