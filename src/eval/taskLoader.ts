/**
 * Handmade task loader (WP-8, eval spec §3).
 *
 * Parses `evals/tasks/*.md` — gray-matter frontmatter + a markdown body — into the
 * normalized {@link EvalTask}. The frontmatter is the agent-invisible config
 * (repo, baseRef, held-out commands, model mixes); the body is the requirement +
 * agent-visible acceptance criteria that the runner writes to `adrPath` before the
 * cascade runs. SWE-bench tasks are produced by `swebench.ts` into the same shape.
 *
 * Fails fast (spec ethos): a malformed task file must surface loudly at load time,
 * never silently skip a scenario or run with a missing held-out suite (which would
 * make convergence unfalsifiable).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { EvalTask, ModelMix } from './types';

/** Default git ref a task resets its repo to, when frontmatter omits `baseRef`. */
const DEFAULT_BASE_REF = 'main';

interface RawFrontmatter {
  id?: unknown;
  repo?: unknown;
  baseRef?: unknown;
  adrPath?: unknown;
  heldOut?: unknown;
  modelMixes?: unknown;
  title?: unknown;
}

function requireString(value: unknown, field: string, taskRef: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Task "${taskRef}": frontmatter field "${field}" must be a non-empty string.`);
  }
  return value.trim();
}

function parseHeldOut(value: unknown, taskRef: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `Task "${taskRef}": "heldOut" must be a non-empty array of shell commands ` +
        '(the independent acceptance suite — without it convergence cannot be checked).',
    );
  }
  return value.map((cmd, i) => {
    if (typeof cmd !== 'string' || cmd.trim() === '') {
      throw new Error(`Task "${taskRef}": heldOut[${i}] must be a non-empty string.`);
    }
    return cmd.trim();
  });
}

function parseModelMixes(value: unknown, taskRef: string): ModelMix[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Task "${taskRef}": "modelMixes" must be a non-empty array of { plan, execute }.`);
  }
  return value.map((m, i) => {
    const mix = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
    const plan = mix.plan;
    const execute = mix.execute;
    if (typeof plan !== 'string' || !plan.trim() || typeof execute !== 'string' || !execute.trim()) {
      throw new Error(
        `Task "${taskRef}": modelMixes[${i}] must have string "plan" and "execute" aliases.`,
      );
    }
    return { plan: plan.trim(), execute: execute.trim() };
  });
}

/** Derive a title: explicit frontmatter wins, else the first markdown `# heading`, else the id. */
function deriveTitle(fmTitle: unknown, body: string, id: string): string {
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim();
  const heading = body.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : id;
}

/**
 * Parse one task markdown document. `fallbackId` (e.g. the filename) is used only for
 * error messages and as the id when frontmatter omits one.
 */
export function parseTask(raw: string, fallbackId: string): EvalTask {
  const { data, content } = matter(raw);
  const fm = data as RawFrontmatter;
  const id = typeof fm.id === 'string' && fm.id.trim() ? fm.id.trim() : fallbackId;

  const body = content.trim();
  if (body === '') {
    throw new Error(`Task "${id}": body is empty (the requirement text written to the loops).`);
  }

  return {
    id,
    source: 'handmade',
    repo: requireString(fm.repo, 'repo', id),
    baseRef:
      typeof fm.baseRef === 'string' && fm.baseRef.trim() ? fm.baseRef.trim() : DEFAULT_BASE_REF,
    adrPath: requireString(fm.adrPath, 'adrPath', id),
    heldOut: parseHeldOut(fm.heldOut, id),
    modelMixes: parseModelMixes(fm.modelMixes, id),
    body,
    title: deriveTitle(fm.title, body, id),
  };
}

/**
 * Load every `*.md` task under `dir` (non-recursive), sorted by id for a stable run
 * order. Returns `[]` if the directory is absent (lets a SWE-bench-only run proceed).
 */
export async function loadTasks(dir: string): Promise<EvalTask[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const files = entries.filter((f) => f.endsWith('.md')).sort();
  const tasks = await Promise.all(
    files.map(async (file) => {
      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      return parseTask(raw, path.basename(file, '.md'));
    }),
  );

  // Reject duplicate ids — two tasks with the same id would collide in results.
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) throw new Error(`Duplicate task id "${t.id}" in ${dir}.`);
    seen.add(t.id);
  }
  return tasks;
}
