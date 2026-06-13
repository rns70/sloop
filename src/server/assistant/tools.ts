import { Type } from 'typebox';
import type { Tool, ToolCall } from '@earendil-works/pi-ai';
import type { AdrDoc, ModelRegistry, RoleDef, TemplateDef } from '../../shared/index';

/**
 * The agent's view of the workspace: read/list/search plus the two write primitives
 * (structured ADR write, raw file write). Implemented by the real backend over the
 * FilesService + fs, and by the mock in memory. Tools never reach the filesystem directly.
 */
export interface AssistantWorkspace {
  listAdrs(): Promise<AdrDoc[]>;
  readAdr(relPath: string): Promise<AdrDoc>;
  writeAdr(doc: AdrDoc): Promise<void>;
  listRoles(): Promise<RoleDef[]>;
  listTemplates(): Promise<TemplateDef[]>;
  /** Write a full file verbatim under the workspace (used for roles/templates). */
  writeRaw(relPath: string, content: string): Promise<void>;
  readModelRegistry(): Promise<ModelRegistry>;
}

/** Normalized executor result: `ok` drives the UI chip, `text` is fed back to the model. */
export interface ToolRunResult { ok: boolean; text: string; path?: string }

/** kebab-case a string into a filename-safe id; never empty. (Mirrors web `slugify`.) */
function slugify(name: string): string {
  const s = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

/** First of `base`, `base-2`, … not already in `taken`. (Mirrors web `uniqueSlug`.) */
function uniqueSlug(base: string, taken: Set<string>): string {
  const b = slugify(base);
  if (!taken.has(b)) return b;
  for (let i = 2; ; i += 1) { const c = `${b}-${i}`; if (!taken.has(c)) return c; }
}

/** basename without extension: 'databank/x/auth.md' -> 'auth'. */
function baseId(path: string | undefined): string {
  if (!path) return '';
  return (path.split('/').pop() ?? '').replace(/\.md$/, '');
}

export const ASSISTANT_TOOLS: Tool[] = [
  {
    name: 'list_docs',
    description: 'List all databank ADRs (path + title), role ids, and template ids.',
    parameters: Type.Object({}),
  },
  {
    name: 'read_doc',
    description: 'Read the full markdown body of one databank ADR by its workspace-relative path (e.g. databank/auth.md).',
    parameters: Type.Object({ path: Type.String({ description: 'e.g. databank/auth.md' }) }),
  },
  {
    name: 'search',
    description: 'Find databank ADRs, roles, or templates whose id/path or body contains the query (case-insensitive substring).',
    parameters: Type.Object({ query: Type.String() }),
  },
  {
    name: 'edit_doc',
    description: 'Overwrite an existing document. For a databank ADR, content is the new markdown body. For a role/template file, content is the full file.',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  },
  {
    name: 'create_adr',
    description: 'Create a new databank ADR. content is the markdown body only.',
    parameters: Type.Object({ title: Type.String(), content: Type.String(), slug: Type.Optional(Type.String()) }),
  },
  {
    name: 'create_role',
    description: 'Create a new role file. content is the FULL file: YAML frontmatter (id, name, defaultModel, optional color), a blank line, then the brief.',
    parameters: Type.Object({ content: Type.String(), slug: Type.Optional(Type.String()) }),
  },
  {
    name: 'create_template',
    description: 'Create a new template file. content is the FULL file: YAML frontmatter (id, name, stages: name/role/model), a blank line, then guidance.',
    parameters: Type.Object({ content: Type.String(), slug: Type.Optional(Type.String()) }),
  },
];

const CLIP = 6000;
const clip = (t: string): string => (t.length <= CLIP ? t : `${t.slice(0, CLIP)}\n…[truncated]`);

export interface ToolExecutor { run(call: ToolCall): Promise<ToolRunResult> }

export function createToolExecutor(ws: AssistantWorkspace): ToolExecutor {
  return {
    async run(call: ToolCall): Promise<ToolRunResult> {
      try {
        const a = call.arguments ?? {};
        switch (call.name) {
          case 'list_docs': {
            const [adrs, roles, templates] = await Promise.all([ws.listAdrs(), ws.listRoles(), ws.listTemplates()]);
            const lines = [
              ...adrs.map((d) => `ADR  ${d.relPath} — ${d.title}`),
              ...roles.map((r) => `role  ${r.id}`),
              ...templates.map((t) => `template  ${t.id}`),
            ];
            return { ok: true, text: lines.join('\n') || '(empty workspace)' };
          }
          case 'read_doc': {
            const doc = await ws.readAdr(String(a.path));
            return { ok: true, text: clip(doc.body), path: doc.relPath };
          }
          case 'search': {
            const q = String(a.query ?? '').toLowerCase();
            const [adrs, roles, templates] = await Promise.all([ws.listAdrs(), ws.listRoles(), ws.listTemplates()]);
            const adrLines = adrs
              .filter((d) => d.relPath.toLowerCase().includes(q) || d.body.toLowerCase().includes(q))
              .map((d) => `${d.relPath} — ${d.title}`);
            const roleLines = roles
              .filter((r) => r.id.toLowerCase().includes(q) || r.brief.toLowerCase().includes(q))
              .map((r) => `role  ${r.id}`);
            const templateLines = templates
              .filter((t) => t.id.toLowerCase().includes(q) || t.guidance.toLowerCase().includes(q))
              .map((t) => `template  ${t.id}`);
            const lines = [...adrLines, ...roleLines, ...templateLines];
            return { ok: true, text: lines.length ? lines.join('\n') : 'No matches.' };
          }
          case 'edit_doc': {
            const path = String(a.path);
            const content = String(a.content ?? '');
            if (path.startsWith('databank/')) {
              const adr = await ws.readAdr(path); // throws if unknown
              await ws.writeAdr({ ...adr, body: content });
            } else {
              await ws.writeRaw(path, content);
            }
            return { ok: true, text: `Edited ${path}.`, path };
          }
          case 'create_adr': {
            const taken = new Set((await ws.listAdrs()).map((d) => baseId(d.relPath)));
            const id = uniqueSlug(baseId(String(a.slug ?? '')) || slugify(String(a.title ?? 'untitled')), taken);
            const relPath = `databank/${id}.md`;
            await ws.writeAdr({ id, relPath, title: String(a.title ?? 'Untitled'), body: String(a.content ?? ''), acceptanceCriteria: [] });
            return { ok: true, text: `Created ${relPath}.`, path: relPath };
          }
          case 'create_role':
          case 'create_template': {
            const kind = call.name === 'create_role' ? 'roles' : 'templates';
            const taken = new Set((kind === 'roles' ? await ws.listRoles() : await ws.listTemplates()).map((x) => x.id));
            const rawSlug = String(a.slug ?? '');
            const id = uniqueSlug(rawSlug ? baseId(rawSlug) : slugify(kind), taken);
            const relPath = `.sloop/${kind}/${id}.md`;
            await ws.writeRaw(relPath, String(a.content ?? ''));
            return { ok: true, text: `Created ${relPath}.`, path: relPath };
          }
          default:
            return { ok: false, text: `Unknown tool: ${call.name}` };
        }
      } catch (e: unknown) {
        return { ok: false, text: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
