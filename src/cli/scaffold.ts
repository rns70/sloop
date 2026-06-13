// Idempotent workspace initializer. Copies the bundled seed (assets/init-template)
// into a target dir, ensures a git repo (required for loops diffing), and adds a
// .gitignore entry for transient cascade run state. Never overwrites existing files.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// assets/init-template lives at the repo root, two levels up from src/cli/.
const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/init-template');

const GITIGNORE_LINE = 'cascades/';

export interface ScaffoldResult {
  /** Workspace-relative paths newly created by this run (excludes ones already present). */
  created: string[];
  /** True iff this run ran `git init` (false if the dir was already a repo). */
  gitInitialized: boolean;
}

/** Initialize `root` as a sloop workspace + target repo. Safe to re-run. */
export async function scaffold(root: string): Promise<ScaffoldResult> {
  const created: string[] = [];

  const gitInitialized = await ensureGitRepo(root);
  await copySeed(SEED_DIR, root, '', created);
  await ensureGitignore(root, created);

  return { created, gitInitialized };
}

/** `git init` only when `.git` is absent. Throws a clear error if git is unavailable. */
async function ensureGitRepo(root: string): Promise<boolean> {
  if (await pathExists(path.join(root, '.git'))) return false;
  try {
    await run('git', ['init', '-q'], { cwd: root });
  } catch (err) {
    throw new Error(
      `sloop needs git to diff the loops, but \`git init\` failed in ${root}. ` +
        `Install git and try again. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  return true;
}

/** Recursively copy seed → dest, creating only missing files. */
async function copySeed(seedDir: string, destRoot: string, rel: string, created: string[]): Promise<void> {
  const entries = await fs.readdir(path.join(seedDir, rel), { withFileTypes: true });
  for (const entry of entries) {
    const childRel = path.join(rel, entry.name);
    const dest = path.join(destRoot, childRel);
    if (entry.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      await copySeed(seedDir, destRoot, childRel, created);
    } else if (!(await pathExists(dest))) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(path.join(seedDir, childRel), dest);
      created.push(childRel.split(path.sep).join('/'));
    }
  }
}

/** Ensure `.gitignore` contains the cascades line exactly once. */
async function ensureGitignore(root: string, created: string[]): Promise<void> {
  const file = path.join(root, '.gitignore');
  let body = '';
  try {
    body = await fs.readFile(file, 'utf8');
  } catch {
    // No .gitignore yet — we'll create it.
  }
  const lines = body.split('\n').map((l) => l.trim());
  if (lines.includes(GITIGNORE_LINE)) return;

  const prefix = body.length > 0 && !body.endsWith('\n') ? '\n' : '';
  await fs.writeFile(file, `${body}${prefix}${GITIGNORE_LINE}\n`, 'utf8');
  if (body.length === 0) created.push('.gitignore');
}

async function pathExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}
