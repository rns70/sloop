/**
 * Eval CLI (WP-8) — `npm run eval`. The composition root: it is the one place allowed
 * to mint the run-id + timestamp (passed down so shared/runner code stays clock-free,
 * spec §10), load the task suite (handmade + SWE-bench subset), drive the matrix, and
 * write `summary.md` + `meta.json`.
 *
 * Usage:
 *   npm run eval                         run full matrix (both systems), N=1
 *   npm run eval -- --trials 3           N trials per (task × mix × system) — headline variance
 *   npm run eval -- --systems sloop      restrict systems (comma-separated)
 *   npm run eval -- --run-id my-run      pin the output dir name
 *   npm run eval -- --compare A B        diff two prior runs (resolved% + $ deltas)
 *   SLOOP_DRY_RUN=1 npm run eval         plumbing smoke (skips agents) — NEVER headline numbers
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_RATES } from './cost';
import { loadRuns, renderCompare, writeSummary } from './report';
import { runMatrix } from './runner';
import { loadSwebenchSubset, readSubsetLabel } from './swebench';
import { loadTasks } from './taskLoader';
import type { EvalSystem, EvalTask, RunMeta, RunResult } from './types';

const EVALS_ROOT = path.resolve('evals');
const TASKS_DIR = path.join(EVALS_ROOT, 'tasks');
const SWEBENCH_FILE = path.join(EVALS_ROOT, 'swebench', 'subset.json');
const RESULTS_DIR = path.join(EVALS_ROOT, 'results');
const WORKSPACE_TEMPLATE = path.resolve('fixtures', 'sample-workspace');
const REPOS_ROOT = path.join(EVALS_ROOT, 'repos');

const ALL_SYSTEMS: EvalSystem[] = ['sloop', 'baseline-flat'];

interface CliArgs {
  trials: number;
  systems: EvalSystem[];
  runId?: string;
  compare?: [string, string];
  swebench: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { trials: 1, systems: ALL_SYSTEMS, swebench: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--trials') {
      const n = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(n) || n < 1) throw new Error('--trials requires a positive integer.');
      args.trials = n;
    } else if (a === '--systems') {
      const list = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const invalid = list.filter((s) => !ALL_SYSTEMS.includes(s as EvalSystem));
      if (invalid.length) throw new Error(`Unknown system(s): ${invalid.join(', ')}.`);
      args.systems = list as EvalSystem[];
    } else if (a === '--run-id') {
      args.runId = argv[++i];
    } else if (a === '--no-swebench') {
      args.swebench = false;
    } else if (a === '--compare') {
      const aId = argv[++i];
      const bId = argv[++i];
      if (!aId || !bId) throw new Error('--compare requires two run ids: --compare <runA> <runB>.');
      args.compare = [aId, bId];
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

/** Timestamp-based run id (YYYYMMDD-HHMMSS, UTC) — minted here, the composition root. */
function makeRunId(now: Date): string {
  const z = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getUTCFullYear()}${z(now.getUTCMonth() + 1)}${z(now.getUTCDate())}-` +
    `${z(now.getUTCHours())}${z(now.getUTCMinutes())}${z(now.getUTCSeconds())}`
  );
}

async function loadRunDir(runId: string): Promise<{ meta: RunMeta; runs: RunResult[] }> {
  const dir = path.join(RESULTS_DIR, runId);
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as RunMeta;
  const runs = await loadRuns(path.join(dir, 'runs.jsonl'));
  return { meta, runs };
}

async function doCompare([aId, bId]: [string, string]): Promise<void> {
  const [a, b] = await Promise.all([loadRunDir(aId), loadRunDir(bId)]);
  process.stdout.write(renderCompare(a, b));
}

async function doRun(args: CliArgs): Promise<void> {
  const now = new Date();
  const runId = args.runId ?? makeRunId(now);
  const createdAt = now.toISOString();
  const outDir = path.join(RESULTS_DIR, runId);
  await fs.mkdir(outDir, { recursive: true });

  const handmade = await loadTasks(TASKS_DIR);
  const swebench = args.swebench ? await loadSwebenchSubset(SWEBENCH_FILE) : [];
  const swebenchLabel = args.swebench ? await readSubsetLabel(SWEBENCH_FILE) : '';
  const tasks: EvalTask[] = [...handmade, ...swebench];

  if (tasks.length === 0) {
    throw new Error(`No tasks found (looked in ${TASKS_DIR} and ${SWEBENCH_FILE}).`);
  }

  process.stdout.write(
    `sloop eval — run ${runId}\n` +
      `  tasks: ${tasks.length} (${handmade.length} handmade, ${swebench.length} swebench)\n` +
      `  systems: ${args.systems.join(', ')} | trials: ${args.trials}\n` +
      `  dry-run: ${process.env.SLOOP_DRY_RUN ? 'YES (plumbing only)' : 'no'}\n\n`,
  );

  const { runs, meta } = await runMatrix({
    runId,
    createdAt,
    trials: args.trials,
    tasks,
    systems: args.systems,
    outDir,
    workspaceTemplateDir: WORKSPACE_TEMPLATE,
    reposRoot: REPOS_ROOT,
    env: process.env,
    rates: DEFAULT_RATES,
    onLog: (m) => process.stdout.write(`${m}\n`),
  });

  await fs.writeFile(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  const summaryPath = await writeSummary(outDir, runs, meta, { swebenchLabel });

  process.stdout.write(`\n✓ ${runs.length} runs → ${path.relative(process.cwd(), summaryPath)}\n`);
  if (meta.dryRun) {
    process.stdout.write(
      '⚠️  SLOOP_DRY_RUN: these are PLUMBING numbers, not headline results. ' +
        'Re-run with API keys (ANTHROPIC_API_KEY / NEBIUS_API_KEY) and no SLOOP_DRY_RUN.\n',
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.compare) await doCompare(args.compare);
  else await doRun(args);
}

main().catch((err) => {
  process.stderr.write(`eval failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
