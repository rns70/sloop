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
import { parseCriteriaFromBody, upsertCriteriaInBody } from '../../shared';

const DATABANK_DIR = 'databank';
const DATABANK_PREFIX = `${DATABANK_DIR}/`;
const CASCADES_DIR = 'cascades';

/** Failure modes of `moveAdr`, discriminated by `code` so the API layer can map
 *  them to HTTP statuses without importing fs-specific error types. */
export class MoveError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'MoveError';
  }
}

/** Failure modes of `deleteAdr`, discriminated by `code` so the API layer can map
 *  them to HTTP statuses without importing fs-specific error types. */
export class DeleteError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'DeleteError';
  }
}
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
    // Recursive so ADRs organised into subfolders (databank/auth/adr-007.md) are listed
    // with their full relPath — the web sidebar derives its folder tree from those paths.
    const files = await listMarkdownRecursive(this.abs(DATABANK_DIR));
    const adrs = await Promise.all(
      files.map((rel) => this.readAdr(path.join(DATABANK_DIR, rel))),
    );
    return adrs.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  async readAdr(relPath: string): Promise<AdrDoc> {
    const raw = await fs.readFile(this.abs(relPath), 'utf8');
    const { data, body } = parseFrontmatter<Partial<AdrDoc>>(raw);
    const parsed = parseCriteriaFromBody(body);
    // Body is authoritative. Legacy files keep criteria in frontmatter — fall back
    // to them and inject a canonical section into the returned body so the editor
    // shows them immediately (disk migrates on the next write).
    const acceptanceCriteria = parsed.hasSection
      ? parsed.criteria
      : normalizeCriteria(data.acceptanceCriteria);
    let outBody = body;
    if (!parsed.hasSection && acceptanceCriteria.length > 0) {
      outBody = upsertCriteriaInBody(body, acceptanceCriteria);
    }
    return {
      id: String(data.id ?? ''),
      relPath,
      title: String(data.title ?? ''),
      body: outBody,
      acceptanceCriteria,
    };
  }

  async writeAdr(doc: AdrDoc): Promise<void> {
    // The body is the source of truth for ADR criteria (the editor edits the body).
    // If the body has a criteria section, use it; otherwise fall back to the field
    // (covers programmatic creation, e.g. createDatabankItem with an empty list).
    const parsed = parseCriteriaFromBody(doc.body);
    const criteria = parsed.hasSection ? parsed.criteria : doc.acceptanceCriteria;
    // Always re-serialize so the on-disk section is canonical (ids filled, format normalized).
    const body = upsertCriteriaInBody(doc.body, criteria);
    const frontmatter = { id: doc.id, title: doc.title };
    await this.writeFile(doc.relPath, serializeFrontmatter(frontmatter, body));
  }

  async moveAdr(from: string, to: string): Promise<void> {
    this.assertInDatabank(from);
    this.assertInDatabank(to);
    if (from === to) return;

    const adrs = await this.listAdrs();
    const relPaths = adrs.map((a) => a.relPath);
    const isFile = relPaths.includes(from);
    const isFolder = relPaths.some((p) => p.startsWith(`${from}/`));
    if (!isFile && !isFolder) {
      throw new MoveError('not_found', `Nothing to move at: ${from}`);
    }

    if (isFolder) {
      // Cycle guard: cannot move a folder into itself or a descendant of itself.
      if (to === from || to.startsWith(`${from}/`)) {
        throw new MoveError('conflict', `Cannot move ${from} into its own subtree`);
      }
      await this.moveFolder(from, to, relPaths);
      return;
    }

    // Single file.
    await this.assertFileDestinationFree(from, to);
    await this.renamePath(from, to);
  }

  /** Guard a single-file destination. Rejects a real collision or a folder sitting at
   *  `to` with a precise message, but permits a case-only rename of the same file
   *  (`a.md` -> `A.md`) on case-insensitive volumes — see `isSameFile`. */
  private async assertFileDestinationFree(fromRel: string, toRel: string): Promise<void> {
    const kind = await statKind(this.abs(toRel));
    if (kind === null) return; // free
    if (kind === 'dir') {
      throw new MoveError('conflict', `Destination is a folder: ${toRel}`);
    }
    if (await isSameFile(this.abs(fromRel), this.abs(toRel))) return; // case-only rename
    throw new MoveError('conflict', `Destination already exists: ${toRel}`);
  }

  /** Move a folder prefix. Atomic dir rename when the destination is free (or it's a
   *  case-only rename of the same folder); otherwise a per-descendant-file merge into an
   *  existing destination folder. The merge is all-or-nothing: every target is validated
   *  for collisions and type clashes before any file is touched, and an unexpected mid-merge
   *  I/O failure rolls back the moves already made so the tree is never left half-merged. */
  private async moveFolder(from: string, to: string, relPaths: string[]): Promise<void> {
    const kind = await statKind(this.abs(to));
    if (kind === null) {
      await this.renamePath(from, to);
      return;
    }
    if (kind === 'file') {
      throw new MoveError('conflict', `Destination exists as a file: ${to}`);
    }
    // A case-only rename of the folder itself (`auth` -> `Auth`) reports the destination as
    // existing on case-insensitive volumes; it's the same inode, so rename it directly.
    if (await isSameFile(this.abs(from), this.abs(to))) {
      await this.renamePath(from, to);
      return;
    }
    // Merge into an existing folder. Validate ALL targets up front (collisions and
    // file/folder type clashes) so the merge either fully applies or doesn't start.
    const descendants = relPaths.filter((p) => p.startsWith(`${from}/`));
    const targets = descendants.map((p) => `${to}/${p.slice(from.length + 1)}`);
    for (const target of targets) {
      if ((await statKind(this.abs(target))) !== null) {
        throw new MoveError('conflict', `Destination already exists: ${target}`);
      }
    }
    // Past validation only genuine I/O errors remain. Track each completed move so a
    // late failure can be unwound, keeping the merge atomic.
    const undo: Array<[string, string]> = [];
    try {
      for (let i = 0; i < descendants.length; i += 1) {
        await this.renamePath(descendants[i], targets[i]);
        undo.push([targets[i], descendants[i]]);
      }
    } catch (err) {
      for (let i = undo.length - 1; i >= 0; i -= 1) {
        await this.renamePath(undo[i][0], undo[i][1]).catch(() => {});
      }
      throw err;
    }
  }

  /** fs.rename with parent-dir creation and empty-source-dir pruning, all under root. */
  private async renamePath(fromRel: string, toRel: string): Promise<void> {
    const fromAbs = this.abs(fromRel);
    const toAbs = this.abs(toRel);
    await fs.mkdir(path.dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs);
    await this.pruneEmptyDirs(path.dirname(fromRel));
  }

  /** Remove now-empty directories from `relDir` up to (but not including) databank/. */
  private async pruneEmptyDirs(relDir: string): Promise<void> {
    let dir = relDir;
    while (dir.startsWith(DATABANK_PREFIX)) {
      try {
        await fs.rmdir(this.abs(dir)); // only succeeds when empty
      } catch {
        return; // non-empty or already gone — stop climbing
      }
      dir = path.dirname(dir);
    }
  }

  /** Reject paths that normalize outside databank/ (traversal defense). */
  private assertInDatabank(relPath: string): void {
    if (!isInsideDatabank(relPath)) {
      throw new MoveError('invalid', `Path is outside databank/: ${relPath}`);
    }
  }

  async deleteAdr(relPath: string): Promise<void> {
    // Traversal defense, and never let a caller wipe the databank/ root itself —
    // only files and folders *inside* it are deletable.
    if (!isInsideDatabank(relPath) || path.normalize(relPath) === DATABANK_DIR) {
      throw new DeleteError('invalid', `Refusing to delete outside databank/ or its root: ${relPath}`);
    }

    const relPaths = (await this.listAdrs()).map((a) => a.relPath);
    const isFile = relPaths.includes(relPath);
    const isFolder = relPaths.some((p) => p.startsWith(`${relPath}/`));
    if (!isFile && !isFolder) {
      throw new DeleteError('not_found', `Nothing to delete at: ${relPath}`);
    }

    // recursive handles both a single file and a whole folder subtree.
    await fs.rm(this.abs(relPath), { recursive: true, force: true });
    await this.pruneEmptyDirs(path.dirname(relPath));
  }

  async readLoop(relPath: string): Promise<LoopDoc> {
    const raw = await fs.readFile(this.abs(relPath), 'utf8');
    const { data, body } = parseFrontmatter<LoopFrontmatter>(raw);
    const parsed = parseCriteriaFromBody(body);
    // Body is the on-disk source; fall back to legacy frontmatter criteria.
    const acceptanceCriteria = parsed.hasSection
      ? parsed.criteria
      : normalizeCriteria(data.acceptanceCriteria);
    return { frontmatter: { ...data, acceptanceCriteria }, body, relPath };
  }

  async writeLoop(loop: LoopDoc): Promise<void> {
    // The engine mutates loop.frontmatter.acceptanceCriteria (passed/verdicts), so
    // the structured field is the source for loops. Serialize it into the body and
    // drop it from frontmatter.
    const { acceptanceCriteria, ...frontmatter } = loop.frontmatter;
    const body = upsertCriteriaInBody(loop.body, acceptanceCriteria);
    await this.writeFile(
      loop.relPath,
      serializeFrontmatter(frontmatter as Record<string, unknown>, body),
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

  /** Every cascade id (subdirectory name under `cascades/`); `[]` if the dir is absent.
   *  Cascade-level summary lives across the dir's loops + engine meta, so the API layer
   *  rebuilds each summary via the engine — this only enumerates the ids. */
  async listCascadeIds(): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(this.abs(CASCADES_DIR), { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
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
    if (c.locked !== undefined) criterion.locked = Boolean(c.locked);
    return criterion;
  });
}

/** True if `relPath` normalizes to databank/ or somewhere inside it (traversal defense). */
function isInsideDatabank(relPath: string): boolean {
  const norm = path.normalize(relPath);
  return norm === DATABANK_DIR || norm.startsWith(DATABANK_PREFIX);
}

/** What lives at `abs`: a regular `file`, a `dir`, or `null` if nothing is there. */
async function statKind(abs: string): Promise<'file' | 'dir' | null> {
  try {
    const st = await fs.stat(abs);
    return st.isDirectory() ? 'dir' : 'file';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * True when two paths resolve to the *same* on-disk entry (identical device +
 * inode). This is how a case-only rename (`a.md` -> `A.md`) is told apart from a
 * real collision: on a case-insensitive volume (default on macOS/Windows) the
 * destination "already exists" but is the very file being moved, so the rename is
 * legitimate; on a case-sensitive volume a pre-existing `A.md` is a distinct inode
 * and the move is a genuine conflict.
 */
async function isSameFile(absA: string, absB: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([fs.stat(absA), fs.stat(absB)]);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
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
