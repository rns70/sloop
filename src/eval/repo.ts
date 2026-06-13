/**
 * Repo + workspace lifecycle for a run (WP-8, eval spec §5 steps 1–2, 6).
 *
 * Two distinct git trees per run:
 *  - the **sloop workspace** (scratch): `.sloop/` registry + `databank/` + `cascades/`.
 *    Seeded from a workflow, git-committed at a baseline, then the requirement ADR is
 *    written so `GitService.diffDatabank()` shows it as a change the architect plans on.
 *  - the **target repo**: where the executor's Pi agent edits code and the held-out
 *    suite runs. Reset to `baseRef` before each run (`git reset --hard && git clean -fd`).
 *
 * SWE-bench tasks reset + run held-out inside the instance's prepared Docker image
 * instead of a local repo (gated on docker being present).
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { runVerify } from '../server/executor/verify';
import type { EvalTask } from './types';

const exec = promisify(execFile);

/** Run a git subcommand in `cwd`, throwing with stderr on failure. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a handmade target repo is a git repo with `baseRef` available. If it has no
 * `.git`, initialize one and commit the tracked files as the base branch — so the
 * tracked file set (committed in the sloop repo) is the source of truth and the on-demand
 * `.git` (gitignored) makes the spec's reset commands work. Idempotent.
 */
export async function ensureHandmadeRepo(repoDir: string, baseRef: string): Promise<void> {
  if (!(await exists(repoDir))) {
    throw new Error(`Target repo not found: ${repoDir}`);
  }
  if (await exists(path.join(repoDir, '.git'))) return;

  await git(repoDir, ['init', '-q']);
  await git(repoDir, ['symbolic-ref', 'HEAD', `refs/heads/${baseRef}`]);
  await git(repoDir, ['add', '-A']);
  // Deterministic identity + date so the baseline commit is reproducible.
  await exec(
    'git',
    [
      '-c',
      'user.email=eval@sloop.local',
      '-c',
      'user.name=sloop-eval',
      'commit',
      '-q',
      '-m',
      'eval baseline',
    ],
    {
      cwd: repoDir,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      },
    },
  );
}

/**
 * Reset a local git repo to `baseRef` and remove untracked files (eval spec §5.1) —
 * the idempotent setup that guarantees no cross-run drift (spec §10).
 */
export async function resetGitRepo(repoDir: string, baseRef: string): Promise<void> {
  await git(repoDir, ['checkout', '-f', baseRef]);
  await git(repoDir, ['reset', '--hard', baseRef]);
  await git(repoDir, ['clean', '-fd']);
}

/**
 * Create a fresh scratch sloop workspace: copy the `.sloop/` workflow (config registry,
 * roles, workflows), add an empty `databank/`, git-init and commit a baseline so the
 * subsequent requirement write registers as a diff. `templateWorkspaceDir` is a directory
 * containing a `.sloop/` subtree (e.g. `fixtures/sample-workspace`).
 */
export async function setupWorkspace(
  scratchDir: string,
  templateWorkspaceDir: string,
): Promise<string> {
  await fs.rm(scratchDir, { recursive: true, force: true });
  await fs.mkdir(scratchDir, { recursive: true });
  await fs.cp(path.join(templateWorkspaceDir, '.sloop'), path.join(scratchDir, '.sloop'), {
    recursive: true,
  });
  await fs.mkdir(path.join(scratchDir, 'databank'), { recursive: true });
  await fs.mkdir(path.join(scratchDir, 'cascades'), { recursive: true });
  // Keep empty dirs in git so diffDatabank has a committed baseline to diff against.
  await fs.writeFile(path.join(scratchDir, 'databank', '.gitkeep'), '', 'utf8');

  await git(scratchDir, ['init', '-q']);
  await git(scratchDir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  await git(scratchDir, ['add', '-A']);
  await exec(
    'git',
    [
      '-c',
      'user.email=eval@sloop.local',
      '-c',
      'user.name=sloop-eval',
      'commit',
      '-q',
      '-m',
      'workspace baseline',
    ],
    { cwd: scratchDir },
  );
  return scratchDir;
}

/**
 * Write the task's requirement to `adrPath` in the workspace databank — the "apply the
 * requirement" step. Minimal frontmatter (id + title) + the task body (which carries the
 * agent-visible acceptance criteria). This creates the databank diff the architect plans on.
 */
export async function applyRequirement(workspaceDir: string, task: EvalTask): Promise<void> {
  const abs = path.join(workspaceDir, task.adrPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const id = path.basename(task.adrPath, '.md');
  const doc = `---\nid: ${id}\ntitle: ${JSON.stringify(task.title)}\n---\n\n${task.body}\n`;
  await fs.writeFile(abs, doc, 'utf8');
}

/**
 * Run a held-out suite locally and report pass/fail per command. `independentPass` is
 * true iff every command exits 0 — judged by the harness, independent of the agents.
 */
export async function runHeldOutLocal(
  commands: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ pass: boolean; results: { command: string; passed: boolean }[] }> {
  const results: { command: string; passed: boolean }[] = [];
  for (const command of commands) {
    const passed = await runVerify(command, cwd, { env });
    results.push({ command, passed });
  }
  return { pass: results.every((r) => r.passed), results };
}

/** Whether `docker` is on PATH (gates the SWE-bench env path). */
export async function dockerAvailable(): Promise<boolean> {
  try {
    await exec('docker', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a held-out suite inside a SWE-bench instance's prepared image. Each command runs
 * in a fresh container at the instance's repo path (so state never leaks between runs).
 * Requires docker + the image pulled locally (spec §8 feasibility).
 */
export async function runHeldOutInDocker(
  task: EvalTask,
  commands: readonly string[],
): Promise<{ pass: boolean; results: { command: string; passed: boolean }[] }> {
  const env = task.swebench;
  if (!env) throw new Error(`Task "${task.id}" has no swebench env for the docker held-out path.`);
  const results: { command: string; passed: boolean }[] = [];
  for (const command of commands) {
    let passed = false;
    try {
      await exec(
        'docker',
        ['run', '--rm', '-w', env.repoPathInImage, env.image, 'bash', '-lc', command],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      passed = true;
    } catch {
      passed = false; // non-zero exit = failed criterion
    }
    results.push({ command, passed });
  }
  return { pass: results.every((r) => r.passed), results };
}
