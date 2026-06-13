import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AdrDoc,
  LoopDoc,
  LoopFrontmatter,
  TemplateDef,
  RoleDef,
  ModelRegistry,
  AcceptanceCriterion,
} from '../../shared';
import type { FilesService } from '../../shared';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';

const DATABANK_DIR = 'databank';
const CASCADES_DIR = 'cascades';
const TEMPLATES_DIR = path.join('.sloop', 'templates');
const ROLES_DIR = path.join('.sloop', 'roles');
const CONFIG_FILE = path.join('.sloop', 'config.md');
const CASCADE_META_FILE = '_cascade.md';

/**
 * Resolve the workspace root: explicit arg wins, then `SLOOP_WORKSPACE`, then the
 * bundled sample workspace. Resolved to an absolute path so every read/write is
 * cwd-independent.
 */
export function resolveWorkspaceRoot(explicit?: string): string {
  const root = explicit ?? process.env.SLOOP_WORKSPACE ?? 'fixtures/sample-workspace';
  return path.resolve(root);
}

/**
 * Disk-backed `FilesService`. Reads/writes loop, ADR, template, role, and config
 * markdown under a single workspace root. On-disk frontmatter keys are camelCase and
 * identical to the shared TS interfaces, so `gray-matter` data maps onto the types
 * with no key remapping.
 */
export class FilesServiceImpl implements FilesService {
  constructor(private readonly root: string) {}

  private abs(relPath: string): string {
    return path.join(this.root, relPath);
  }

  async listAdrs(): Promise<AdrDoc[]> {
    const files = await listMarkdown(this.abs(DATABANK_DIR));
    const adrs = await Promise.all(
      files.map((name) => this.readAdr(path.join(DATABANK_DIR, name))),
    );
    return adrs.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  async readAdr(relPath: string): Promise<AdrDoc> {
    const raw = await fs.readFile(this.abs(relPath), 'utf8');
    const { data, body } = parseFrontmatter<Partial<AdrDoc>>(raw);
    return {
      id: String(data.id ?? ''),
      relPath,
      title: String(data.title ?? ''),
      body,
      acceptanceCriteria: normalizeCriteria(data.acceptanceCriteria),
    };
  }

  async writeAdr(doc: AdrDoc): Promise<void> {
    const frontmatter = {
      id: doc.id,
      title: doc.title,
      acceptanceCriteria: doc.acceptanceCriteria,
    };
    await this.writeFile(doc.relPath, serializeFrontmatter(frontmatter, doc.body));
  }

  async readLoop(relPath: string): Promise<LoopDoc> {
    const raw = await fs.readFile(this.abs(relPath), 'utf8');
    const { data, body } = parseFrontmatter<LoopFrontmatter>(raw);
    return { frontmatter: data, body, relPath };
  }

  async writeLoop(loop: LoopDoc): Promise<void> {
    await this.writeFile(
      loop.relPath,
      serializeFrontmatter(loop.frontmatter as unknown as Record<string, unknown>, loop.body),
    );
  }

  async listLoops(cascadeId: string): Promise<LoopDoc[]> {
    const dir = path.join(CASCADES_DIR, cascadeId);
    const files = await listMarkdownRecursive(this.abs(dir));
    const loopFiles = files.filter((rel) => path.basename(rel) !== CASCADE_META_FILE);
    const loops = await Promise.all(
      loopFiles.map((rel) => this.readLoop(path.join(dir, rel))),
    );
    return loops.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  async listTemplates(): Promise<TemplateDef[]> {
    const files = await listMarkdown(this.abs(TEMPLATES_DIR));
    const templates = await Promise.all(
      files.map(async (name) => {
        const raw = await fs.readFile(this.abs(path.join(TEMPLATES_DIR, name)), 'utf8');
        const { data, body } = parseFrontmatter<Partial<TemplateDef>>(raw);
        return {
          id: String(data.id ?? path.basename(name, '.md')),
          name: String(data.name ?? data.id ?? ''),
          stages: Array.isArray(data.stages) ? data.stages : [],
          guidance: body,
        } satisfies TemplateDef;
      }),
    );
    return templates.sort((a, b) => a.id.localeCompare(b.id));
  }

  async listRoles(): Promise<RoleDef[]> {
    const files = await listMarkdown(this.abs(ROLES_DIR));
    const roles = await Promise.all(
      files.map(async (name) => {
        const raw = await fs.readFile(this.abs(path.join(ROLES_DIR, name)), 'utf8');
        const { data, body } = parseFrontmatter<Partial<RoleDef>>(raw);
        const role: RoleDef = {
          id: String(data.id ?? path.basename(name, '.md')),
          name: String(data.name ?? data.id ?? ''),
          defaultModel: String(data.defaultModel ?? ''),
          brief: body,
        };
        if (data.color !== undefined) role.color = String(data.color);
        return role;
      }),
    );
    return roles.sort((a, b) => a.id.localeCompare(b.id));
  }

  async readModelRegistry(): Promise<ModelRegistry> {
    const raw = await fs.readFile(this.abs(CONFIG_FILE), 'utf8');
    const { data } = parseFrontmatter<Partial<ModelRegistry>>(raw);
    return {
      models: data.models ?? {},
      providers: data.providers ?? ({} as ModelRegistry['providers']),
    };
  }

  private async writeFile(relPath: string, content: string): Promise<void> {
    const abs = this.abs(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
}

/** Construct a disk-backed `FilesService` rooted at `root` (or the env/default root). */
export function createFilesService(root?: string): FilesService {
  return new FilesServiceImpl(resolveWorkspaceRoot(root));
}

/** Coerce loosely-typed frontmatter criteria into well-formed `AcceptanceCriterion[]`. */
function normalizeCriteria(value: unknown): AcceptanceCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const c = (raw ?? {}) as Partial<AcceptanceCriterion>;
    const criterion: AcceptanceCriterion = {
      id: String(c.id ?? ''),
      text: String(c.text ?? ''),
      passed: Boolean(c.passed),
    };
    if (c.verify !== undefined) criterion.verify = String(c.verify);
    return criterion;
  });
}

/** List `*.md` basenames directly in `dir`; `[]` if the directory is absent. */
async function listMarkdown(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name);
}

/** List `*.md` paths under `dir` recursively, relative to `dir`; `[]` if absent. */
async function listMarkdownRecursive(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await listMarkdownRecursive(path.join(dir, entry.name));
      out.push(...nested.map((rel) => path.join(entry.name, rel)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(entry.name);
    }
  }
  return out;
}
