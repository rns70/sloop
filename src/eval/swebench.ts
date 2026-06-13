/**
 * SWE-bench adapter (WP-8, eval spec §8).
 *
 * SWE-bench's structure *is* sloop's eval shape: a repo + an issue + hidden tests
 * (`FAIL_TO_PASS` / `PASS_TO_PASS`). This module maps a small curated subset of
 * instances into the same {@link EvalTask} the handmade loader produces:
 *
 *   problem_statement              → requirement body written to `adrPath`
 *   FAIL_TO_PASS + PASS_TO_PASS    → the held-out suite (run by the harness, hidden)
 *   base_commit                    → baseRef the repo resets to
 *   prepared Docker image          → where the executor + held-out tests run
 *
 * Keep the subset to 5–10 and ALWAYS label outputs "N tasks from SWE-bench Lite",
 * never as a full-benchmark score (spec §8). The honest comparison is the internal
 * sloop-vs-baseline delta on identical instances; the leaderboard is only backdrop.
 *
 * Pure parsing/mapping here (unit-tested); the Docker exec of held-out tests lives in
 * the runner/repo layer, keyed off `EvalTask.swebench`.
 */

import { promises as fs } from 'node:fs';
import type { EvalTask, ModelMix } from './types';

/** Default pytest invocation for an instance that doesn't pin its own `testCmd`. */
const DEFAULT_TEST_CMD = 'python -m pytest -q --no-header';

/** One raw SWE-bench instance as it appears in the subset config (a subset of the dataset fields). */
export interface SwebenchInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  FAIL_TO_PASS: string[];
  PASS_TO_PASS: string[];
  /** Prepared environment image (e.g. `swebench/sweb.eval.x86_64.<id>`). */
  image: string;
  /** Repo path inside the image. Defaults to `/testbed` (SWE-bench convention). */
  repoPathInImage?: string;
  /** Override the held-out test runner for this instance. Defaults to pytest. */
  testCmd?: string;
}

/** The `evals/swebench/subset.json` schema. */
export interface SwebenchSubset {
  /** Required label, surfaced verbatim in summary.md (never a full-benchmark claim). */
  label: string;
  /** Model mixes applied to every instance unless an instance overrides them. */
  defaultModelMixes: ModelMix[];
  instances: SwebenchInstance[];
}

const DEFAULT_REPO_PATH = '/testbed';

function requireStringArray(value: unknown, field: string, ref: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`SWE-bench instance "${ref}": "${field}" must be an array of test ids.`);
  }
  return value.map((v, i) => {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`SWE-bench instance "${ref}": ${field}[${i}] must be a non-empty string.`);
    }
    return v.trim();
  });
}

/**
 * Build the held-out command(s) for an instance: run FAIL_TO_PASS and PASS_TO_PASS
 * through the instance's test runner. Two commands (one per group) so a regression in
 * the previously-passing set is reported distinctly from the target fix.
 */
export function heldOutCommands(instance: SwebenchInstance): string[] {
  const testCmd = instance.testCmd?.trim() || DEFAULT_TEST_CMD;
  const cmds: string[] = [];
  if (instance.FAIL_TO_PASS.length > 0) {
    cmds.push(`${testCmd} ${instance.FAIL_TO_PASS.join(' ')}`);
  }
  if (instance.PASS_TO_PASS.length > 0) {
    cmds.push(`${testCmd} ${instance.PASS_TO_PASS.join(' ')}`);
  }
  if (cmds.length === 0) {
    throw new Error(
      `SWE-bench instance "${instance.instance_id}": no FAIL_TO_PASS or PASS_TO_PASS tests — ` +
        'the held-out suite would be empty, making convergence unfalsifiable.',
    );
  }
  return cmds;
}

/** Sanitize an instance id into a safe loops filename. */
function adrPathFor(instanceId: string): string {
  const safe = instanceId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `loops/swebench-${safe}.md`;
}

/**
 * Map one SWE-bench instance into an {@link EvalTask}. `modelMixes` come from the
 * subset's default (or an explicit override) — the same routing matrix as handmade
 * tasks, so both sources feed one runner.
 */
export function instanceToTask(instance: SwebenchInstance, modelMixes: ModelMix[]): EvalTask {
  const id = instance.instance_id?.trim();
  if (!id) throw new Error('SWE-bench instance is missing "instance_id".');
  if (typeof instance.problem_statement !== 'string' || !instance.problem_statement.trim()) {
    throw new Error(`SWE-bench instance "${id}": "problem_statement" must be a non-empty string.`);
  }
  if (typeof instance.base_commit !== 'string' || !instance.base_commit.trim()) {
    throw new Error(`SWE-bench instance "${id}": "base_commit" must be a non-empty string.`);
  }
  if (typeof instance.image !== 'string' || !instance.image.trim()) {
    throw new Error(`SWE-bench instance "${id}": "image" (prepared env) must be a non-empty string.`);
  }
  // Validate the test groups (also guards heldOutCommands).
  const failToPass = requireStringArray(instance.FAIL_TO_PASS, 'FAIL_TO_PASS', id);
  const passToPass = requireStringArray(instance.PASS_TO_PASS, 'PASS_TO_PASS', id);
  const normalized: SwebenchInstance = {
    ...instance,
    FAIL_TO_PASS: failToPass,
    PASS_TO_PASS: passToPass,
  };

  if (modelMixes.length === 0) {
    throw new Error(`SWE-bench instance "${id}": no model mixes provided.`);
  }

  const body = [
    `# ${instance.repo} — ${id}`,
    '',
    '> Imported from SWE-bench Lite. The held-out test suite (FAIL_TO_PASS + PASS_TO_PASS)',
    '> is hidden from the agents and run independently by the harness.',
    '',
    '## Problem statement',
    '',
    instance.problem_statement.trim(),
  ].join('\n');

  return {
    id,
    source: 'swebench',
    repo: instance.repo,
    baseRef: instance.base_commit.trim(),
    adrPath: adrPathFor(id),
    heldOut: heldOutCommands(normalized),
    modelMixes,
    body,
    title: `${instance.repo} — ${id}`,
    swebench: {
      instanceId: id,
      image: instance.image.trim(),
      repoPathInImage: instance.repoPathInImage?.trim() || DEFAULT_REPO_PATH,
    },
  };
}

/** Parse a subset config object into tasks (instances → EvalTask[]). */
export function parseSubset(subset: SwebenchSubset): EvalTask[] {
  if (!subset || typeof subset.label !== 'string' || !subset.label.trim()) {
    throw new Error('SWE-bench subset: "label" is required (e.g. "5 tasks from SWE-bench Lite").');
  }
  if (!Array.isArray(subset.instances) || subset.instances.length === 0) {
    throw new Error('SWE-bench subset: "instances" must be a non-empty array.');
  }
  if (subset.instances.length > 10) {
    // Keep the subset small (spec §8) — a large local run is slow and never a benchmark score.
    throw new Error(
      `SWE-bench subset has ${subset.instances.length} instances; keep it to 5–10 (spec §8).`,
    );
  }
  const defaults = Array.isArray(subset.defaultModelMixes) ? subset.defaultModelMixes : [];
  return subset.instances.map((inst) => instanceToTask(inst, defaults));
}

/** Read + parse `evals/swebench/subset.json`. Returns `[]` if the file is absent. */
export async function loadSwebenchSubset(filePath: string): Promise<EvalTask[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return parseSubset(JSON.parse(raw) as SwebenchSubset);
}

/** The subset's display label, read straight from the file (for summary.md). Empty string if absent. */
export async function readSubsetLabel(filePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as SwebenchSubset;
    return typeof parsed.label === 'string' ? parsed.label : '';
  } catch {
    return '';
  }
}
