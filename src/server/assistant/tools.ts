import { Type } from 'typebox';
import type { Tool, ToolCall } from '@earendil-works/pi-ai';
import type { AdrDoc, ModelRegistry, RoleDef, WorkflowDef } from '../../shared/index';
import { bodyHasNoCriteria } from '../../shared/index';

/** Warning raised when an ADR is written without acceptance criteria. Surfaced to the agent
 *  (so it self-corrects) and to the UI (as a chip note). */
const NO_CRITERIA_WARNING =
  'This ADR has no acceptance criteria. Add a "## Acceptance criteria" checklist of objectively verifiable items so loops seeded from it can be verified.';

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
  listWorkflows(): Promise<WorkflowDef[]>;
  /** Write a full file verbatim under the workspace (used for roles/workflows). */
  writeRaw(relPath: string, content: string): Promise<void>;
  readModelRegistry(): Promise<ModelRegistry>;
}

/**
 * Normalized executor result: `ok` drives the UI chip, `text` is fed back to the model.
 * `warning` is an optional non-fatal note (e.g. an ADR written without acceptance criteria)
 * surfaced both to the model (appended to `text`) and to the UI (via the tool_result event).
 */
export interface ToolRunResult { ok: boolean; text: string; path?: string; warning?: string }

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

/** basename without extension: 'loops/x/auth.md' -> 'auth'. */
function baseId(path: string | undefined): string {
  if (!path) return '';
  return (path.split('/').pop() ?? '').replace(/\.md$/, '');
}

export const ASSISTANT_TOOLS: Tool[] = [
  {
    name: 'list_docs',
    description: 'List all loops ADRs (path + title), role ids, and workflow ids.',
    parameters: Type.Object({}),
  },
  {
    name: 'read_doc',
    description: 'Read the full markdown body of one loops ADR by its workspace-relative path (e.g. loops/auth.md).',
    parameters: Type.Object({ path: Type.String({ description: 'e.g. loops/auth.md' }) }),
  },
  {
    name: 'search',
    description: 'Find loops ADRs, roles, or workflows whose id/path or body contains the query (case-insensitive substring).',
    parameters: Type.Object({ query: Type.String() }),
  },
  {
    name: 'edit_doc',
    description: 'Overwrite an existing document. For a loops ADR, content is the new markdown body. For a role/workflow file, content is the full file.',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  },
  {
    name: 'create_adr',
    description: 'Create a new loops ADR. content is the markdown body only.',
    parameters: Type.Object({ title: Type.String(), content: Type.String(), slug: Type.Optional(Type.String()) }),
  },
  {
    name: 'create_role',
    description: 'Create a new role file. content is the FULL file: YAML frontmatter (id, name, defaultModel, optional color), a blank line, then the brief.',
    parameters: Type.Object({ content: Type.String(), slug: Type.Optional(Type.String()) }),
  },
  {
    name: 'create_workflow',
    description: 'Create a new workflow file. content is the FULL file: YAML frontmatter (id, name, steps: name/role/model), a blank line, then guidance.',
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
            const [adrs, roles, workflows] = await Promise.all([ws.listAdrs(), ws.listRoles(), ws.listWorkflows()]);
            const lines = [
              ...adrs.map((d) => `ADR  ${d.relPath} — ${d.title}`),
              ...roles.map((r) => `role  ${r.id}`),
              ...workflows.map((w) => `workflow  ${w.id}`),
            ];
            return { ok: true, text: lines.join('\n') || '(empty workspace)' };
          }
          case 'read_doc': {
            const doc = await ws.readAdr(String(a.path));
            return { ok: true, text: clip(doc.body), path: doc.relPath };
          }
          case 'search': {
            const q = String(a.query ?? '').toLowerCase();
            const [adrs, roles, workflows] = await Promise.all([ws.listAdrs(), ws.listRoles(), ws.listWorkflows()]);
            const adrLines = adrs
              .filter((d) => d.relPath.toLowerCase().includes(q) || d.body.toLowerCase().includes(q))
              .map((d) => `${d.relPath} — ${d.title}`);
            const roleLines = roles
              .filter((r) => r.id.toLowerCase().includes(q) || r.brief.toLowerCase().includes(q))
              .map((r) => `role  ${r.id}`);
            const workflowLines = workflows
              .filter((w) => w.id.toLowerCase().includes(q) || w.guidance.toLowerCase().includes(q))
              .map((w) => `workflow  ${w.id}`);
            const lines = [...adrLines, ...roleLines, ...workflowLines];
            return { ok: true, text: lines.length ? lines.join('\n') : 'No matches.' };
          }
          case 'edit_doc': {
            const path = String(a.path);
            const content = String(a.content ?? '');
            if (path.startsWith('loops/')) {
              const adr = await ws.readAdr(path); // throws if unknown
              await ws.writeAdr({ ...adr, body: content });
              const warning = bodyHasNoCriteria(content) ? NO_CRITERIA_WARNING : undefined;
              return { ok: true, text: `Edited ${path}.${warning ? ` ⚠ ${warning}` : ''}`, path, ...(warning ? { warning } : {}) };
            }
            await ws.writeRaw(path, content);
            return { ok: true, text: `Edited ${path}.`, path };
          }
          case 'create_adr': {
            const taken = new Set((await ws.listAdrs()).map((d) => baseId(d.relPath)));
            const id = uniqueSlug(baseId(String(a.slug ?? '')) || slugify(String(a.title ?? 'untitled')), taken);
            const relPath = `loops/${id}.md`;
            const body = String(a.content ?? '');
            await ws.writeAdr({ id, relPath, title: String(a.title ?? 'Untitled'), body, acceptanceCriteria: [], children: [], status: 'idle', outputs: [] });
            const warning = bodyHasNoCriteria(body) ? NO_CRITERIA_WARNING : undefined;
            return { ok: true, text: `Created ${relPath}.${warning ? ` ⚠ ${warning}` : ''}`, path: relPath, ...(warning ? { warning } : {}) };
          }
          case 'create_role':
          case 'create_workflow': {
            const kind = call.name === 'create_role' ? 'roles' : 'workflows';
            const taken = new Set((kind === 'roles' ? await ws.listRoles() : await ws.listWorkflows()).map((x) => x.id));
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
