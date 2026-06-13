/**
 * Result I/O + `summary.md` rendering + `--compare` diff (WP-8, eval spec §4, §8, §10).
 *
 * `runs.jsonl` is the durable record (one {@link RunResult} per line). `renderSummary`
 * turns a run array + {@link RunMeta} into the presentation artifact: a self-describing
 * header (resolved models, task-set, date, trials — so a run is reproducible later),
 * the headline convergence + false-positive rates (mean ± stdev when N>1), the per-mix
 * cost table, the sloop-vs-baseline delta, the Nemotron multi-provider line, and the
 * SWE-bench Pro standardized ≈59% backdrop (context, not a claimed rank).
 *
 * Render functions are pure (string in/out) so they're unit-tested; only the thin
 * read/append/write wrappers touch disk.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { aggregate, type Aggregate, type Stat } from './metrics';
import type { EvalSystem, RunMeta, RunResult } from './types';

// ---- durable run I/O -----------------------------------------------------

/** Append one run as a JSON line to `runs.jsonl` (creating parent dirs). */
export async function appendRun(jsonlPath: string, run: RunResult): Promise<void> {
  await fs.mkdir(path.dirname(jsonlPath), { recursive: true });
  await fs.appendFile(jsonlPath, `${JSON.stringify(run)}\n`, 'utf8');
}

/** Read all runs from a `runs.jsonl` (ignoring blank lines). */
export async function loadRuns(jsonlPath: string): Promise<RunResult[]> {
  const raw = await fs.readFile(jsonlPath, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as RunResult);
}

// ---- formatting helpers --------------------------------------------------

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const usd = (x: number): string => `$${x.toFixed(4)}`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const signedPct = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(1)} pts`;
const signedUsd = (x: number): string => `${x >= 0 ? '+' : '-'}$${Math.abs(x).toFixed(4)}`;

/** Render a Stat as "mean ± stdev" in percent (for trials > 1). */
function statPct(s: Stat | undefined): string {
  if (!s) return 'n/a';
  return `${pct(s.mean)} ± ${pct(s.stdev)}`;
}

const SYSTEM_LABEL: Record<EvalSystem, string> = {
  sloop: 'sloop (full cascade)',
  'baseline-flat': 'baseline-flat (single Pi agent)',
};

/**
 * SWE-bench backdrop, verbatim intent from spec §8: cite the *standardized* SEAL
 * figure as the fair comparator and flag the scaffold caveat explicitly. Context,
 * never a claimed rank.
 */
const SWEBENCH_BACKDROP = [
  '## SWE-bench backdrop (context, not a claimed rank)',
  '',
  'External anchor for "are we in a credible range" — **not** a leaderboard placement.',
  'Leaderboard numbers swing ~30 points on harness/scaffold alone, so a small local',
  'subset vs. a published score is apples-to-oranges by construction.',
  '',
  '- **SWE-bench Pro (standardized, Scale SEAL public set):** top ≈ **59%** (GPT-5.4) —',
  '  every model run through identical scaffolding. **This is the fair comparator.**',
  '- For reference only: SWE-bench Pro vendor scaffold tops ≈80% (Fable 5); Scale private',
  '  set ≈47%. SWE-bench **Verified** is saturated (~95%), so it frames task *type*, not headroom.',
  '',
  '> **Scaffold caveat:** sloop runs its *own* scaffold (decomposition + routing + verify),',
  '> so any sloop number vs. a standardized figure is exactly the apples/oranges to flag.',
  '> The credible claim is the **internal sloop-vs-baseline-flat delta on identical tasks**',
  '> below; the ≈59% figure only frames the neighborhood.',
].join('\n');

// ---- summary.md ----------------------------------------------------------

function renderHeader(meta: RunMeta, agg: Aggregate): string {
  const models = meta.resolvedModels
    .map((m) => `  - \`${m.alias}\` → ${m.provider}:\`${m.id}\``)
    .join('\n');
  const lines = [
    '# sloop eval — results',
    '',
    meta.dryRun
      ? '> ⚠️ **SLOOP_DRY_RUN (plumbing-only).** Agents were skipped; only held-out/verify' +
        ' commands ran. These numbers prove the harness wiring — they are **NOT** headline' +
        ' results. Re-run with API keys (no `SLOOP_DRY_RUN`) for real numbers.'
      : '> Real run against the live backend.',
    '',
    '## Run metadata (self-describing — spec §10)',
    '',
    `- **Run id:** \`${meta.runId}\``,
    `- **Date:** ${meta.createdAt}`,
    `- **Trials (N):** ${meta.trials}`,
    `- **Total runs:** ${agg.totalRuns}`,
    `- **Tasks (${meta.taskIds.length}):** ${meta.taskIds.map((t) => `\`${t}\``).join(', ') || '(none)'}`,
    '- **Resolved models (pinning):**',
    models || '  - (none resolved)',
  ];
  return lines.join('\n');
}

function renderHeadline(agg: Aggregate): string {
  const lines = ['## Headline — convergence & honesty (spec §1)', ''];
  const trials = agg.trials;

  for (const sys of agg.bySystem) {
    if (trials > 1 && agg.variance) {
      lines.push(
        `### ${SYSTEM_LABEL[sys.system]} (${sys.runs} runs, N=${trials} trials)`,
        '',
        `- **True-convergence rate:** ${statPct(agg.variance.convergenceRate[sys.system])}` +
          ` (point: ${pct(sys.convergenceRate)})`,
        `- **Independent-pass rate:** ${statPct(agg.variance.independentPassRate[sys.system])}`,
        `- **False-positive rate:** ${statPct(agg.variance.falsePositiveRate[sys.system])}` +
          ' — converged but held-out failed',
        `- **pass@${trials}:** ${pct(agg.variance.passAtK[sys.system] ?? 0)}`,
        '',
      );
    } else {
      lines.push(
        `### ${SYSTEM_LABEL[sys.system]} (${sys.runs} runs)`,
        '',
        `- **True-convergence rate:** ${pct(sys.convergenceRate)}`,
        `- **Independent-pass rate:** ${pct(sys.independentPassRate)}`,
        `- **False-positive rate:** ${pct(sys.falsePositiveRate)} — converged but held-out failed`,
        '',
      );
    }
  }
  return lines.join('\n');
}

function renderMixTable(agg: Aggregate): string {
  const lines = [
    '## Cost vs. model mix (claim 2 — plan-big / execute-cheap)',
    '',
    '| System | plan → execute | Runs | Success (held-out) | Converged | False-pos | Mean $ | Mean latency |',
    '|---|---|--:|--:|--:|--:|--:|--:|',
  ];
  for (const m of agg.byMix) {
    lines.push(
      `| ${m.system} | \`${m.key}\` | ${m.runs} | ${pct(m.successRate)} | ${pct(m.convergenceRate)} | ` +
        `${pct(m.falsePositiveRate)} | ${usd(m.meanUsd)} | ${secs(m.meanLatencyMs)} |`,
    );
  }
  return lines.join('\n');
}

function renderNemotronLine(agg: Aggregate): string {
  const nemotron = agg.byMix.filter((m) => m.mix.execute === 'nemotron');
  const lines = ['## Multi-provider — Nemotron via Nebius (claim 3)', ''];
  if (nemotron.length === 0) {
    lines.push('_No run used `nemotron` as the executor in this matrix._');
    return lines.join('\n');
  }
  for (const m of nemotron) {
    lines.push(
      `- **${m.system}** \`${m.key}\`: success ${pct(m.successRate)}, mean cost ${usd(m.meanUsd)}, ` +
        `mean latency ${secs(m.meanLatencyMs)} (${m.runs} runs).`,
    );
  }
  lines.push(
    '',
    '> Nemotron (open model, Nebius) as a drop-in executor — same scaffold, different provider.',
    '> Compare its cost/latency against a frontier-executor row above at equal success.',
  );
  return lines.join('\n');
}

function renderDelta(agg: Aggregate): string {
  const lines = ['## sloop vs. baseline-flat — identical tasks (the honest delta)', ''];
  if (!agg.delta) {
    lines.push('_Delta unavailable — the matrix did not run both systems on shared tasks._');
    return lines.join('\n');
  }
  const d = agg.delta;
  lines.push(
    `Computed over the **${d.tasksCompared} task(s) both systems ran** (same inputs, same hidden tests):`,
    '',
    '| Metric | sloop | baseline-flat | Δ (sloop − baseline) |',
    '|---|--:|--:|--:|',
    `| Resolved (held-out pass) | ${d.resolvedPctSloop.toFixed(1)}% | ${d.resolvedPctBaseline.toFixed(1)}% | ${signedPct(d.resolvedPctDelta)} |`,
    `| Mean cost / run | ${usd(d.meanUsdSloop)} | ${usd(d.meanUsdBaseline)} | ${signedUsd(d.meanUsdDelta)} |`,
    '',
    "> Same task, same hidden tests, same scaffold family → the delta isolates sloop's",
    '> decomposition + routing. This is the credible claim; the SWE-bench figure is only backdrop.',
  );
  return lines.join('\n');
}

/**
 * Render the full `summary.md` (pure). `swebenchLabel`, when present, is surfaced as
 * the SWE-bench task-set label (e.g. "5 tasks from SWE-bench Lite").
 */
export function renderSummary(
  runs: readonly RunResult[],
  meta: RunMeta,
  opts: { swebenchLabel?: string } = {},
): string {
  const agg = aggregate(runs);
  const sections = [
    renderHeader(meta, agg),
    renderHeadline(agg),
    renderMixTable(agg),
    renderDelta(agg),
    renderNemotronLine(agg),
  ];
  if (opts.swebenchLabel) {
    sections.push(
      `## SWE-bench task set\n\n${opts.swebenchLabel} (labelled as a subset, never a full-benchmark score).`,
    );
  }
  sections.push(SWEBENCH_BACKDROP);
  return `${sections.join('\n\n')}\n`;
}

/** Render + write `summary.md` next to `runs.jsonl`. */
export async function writeSummary(
  outDir: string,
  runs: readonly RunResult[],
  meta: RunMeta,
  opts: { swebenchLabel?: string } = {},
): Promise<string> {
  const file = path.join(outDir, 'summary.md');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(file, renderSummary(runs, meta, opts), 'utf8');
  return file;
}

// ---- --compare -----------------------------------------------------------

/**
 * Render a diff between two runs (resolved% and $ deltas per system) — the workflow
 * for "did this sloop change actually help?" (spec §10). Pure.
 */
export function renderCompare(
  a: { meta: RunMeta; runs: readonly RunResult[] },
  b: { meta: RunMeta; runs: readonly RunResult[] },
): string {
  const aggA = aggregate(a.runs);
  const aggB = aggregate(b.runs);
  const systems = [...new Set([...aggA.bySystem, ...aggB.bySystem].map((s) => s.system))];

  const lines = [
    '# sloop eval — compare',
    '',
    `**A:** \`${a.meta.runId}\` (${a.meta.createdAt}, N=${a.meta.trials})`,
    `**B:** \`${b.meta.runId}\` (${b.meta.createdAt}, N=${b.meta.trials})`,
    '',
    '## Per-system resolved% and cost (B − A)',
    '',
    '| System | Resolved A | Resolved B | Δ resolved | Mean $ A | Mean $ B | Δ $ |',
    '|---|--:|--:|--:|--:|--:|--:|',
  ];

  for (const sys of systems) {
    const sa = aggA.bySystem.find((s) => s.system === sys);
    const sb = aggB.bySystem.find((s) => s.system === sys);
    const ra = sa?.independentPassRate ?? 0;
    const rb = sb?.independentPassRate ?? 0;
    const ca = sa?.meanUsd ?? 0;
    const cb = sb?.meanUsd ?? 0;
    lines.push(
      `| ${sys} | ${pct(ra)} | ${pct(rb)} | ${signedPct((rb - ra) * 100)} | ${usd(ca)} | ${usd(cb)} | ${signedUsd(cb - ca)} |`,
    );
  }

  // The sloop-vs-baseline delta in each run, side by side.
  lines.push('', '## sloop − baseline delta (each run)', '');
  const da = aggA.delta;
  const db = aggB.delta;
  lines.push(
    `- **A:** ${da ? `${signedPct(da.resolvedPctDelta)} resolved, ${signedUsd(da.meanUsdDelta)} / run` : 'n/a'}`,
    `- **B:** ${db ? `${signedPct(db.resolvedPctDelta)} resolved, ${signedUsd(db.meanUsdDelta)} / run` : 'n/a'}`,
  );
  return `${lines.join('\n')}\n`;
}
