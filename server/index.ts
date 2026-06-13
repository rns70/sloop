import express from "express";
import { join, resolve } from "node:path";
import { getGitDiff, getGitStatus } from "./lib/git.js";
import { appendHistory, readHistory } from "./lib/history.js";
import { readDoc, listDocs, openWorkspace, saveDoc } from "./lib/workspace.js";
import { runPiCascade } from "./lib/runs.js";
import { runEvaluation } from "./lib/evaluation.js";
import { pauseLoop, resumeLoop } from "./lib/loopState.js";
import { appendRunLog, readRuns, updateRunStatus, upsertRun } from "./lib/runStore.js";
import { applyWorktreeChanges, archiveWorktreeRun } from "./lib/apply.js";
import { cleanupWorktree, createRunWorktree } from "./lib/worktrees.js";
import { planCascade, summarizeAffectedDocsForPi } from "./lib/cascade.js";
import type { DocStatus, EvalResult, LoopRun } from "../src/shared/types.js";

const app = express();
const port = Number(process.env.SLOOP_SERVER_PORT ?? 4873);
const defaultWorkspace = resolve(process.env.SLOOP_WORKSPACE ?? process.cwd());

app.use(express.json({ limit: "5mb" }));

app.get("/api/workspace", async (_request, response, next) => {
  try {
    response.json(await openWorkspace(defaultWorkspace));
  } catch (error) {
    next(error);
  }
});

app.get("/api/docs", async (_request, response, next) => {
  try {
    response.json(await listDocs(defaultWorkspace));
  } catch (error) {
    next(error);
  }
});

function docPathParam(request: express.Request): string {
  const value = request.params[0];
  return Array.isArray(value) ? value.join("/") : value;
}

function requiredSourcePath(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new Error("sourcePath is required");
}

app.get(/^\/api\/docs\/(.+)$/, async (request, response, next) => {
  try {
    response.json(await readDoc(defaultWorkspace, docPathParam(request)));
  } catch (error) {
    next(error);
  }
});

app.put(/^\/api\/docs\/(.+)$/, async (request, response, next) => {
  try {
    const { frontmatter, body } = request.body as {
      frontmatter: Record<string, unknown>;
      body: string;
    };
    response.json(await saveDoc(defaultWorkspace, docPathParam(request), frontmatter, body));
  } catch (error) {
    next(error);
  }
});

app.get("/api/git/status", async (_request, response, next) => {
  try {
    response.json(await getGitStatus(defaultWorkspace));
  } catch (error) {
    next(error);
  }
});

app.get("/api/git/diff", async (_request, response, next) => {
  try {
    response.json(await getGitDiff(defaultWorkspace));
  } catch (error) {
    next(error);
  }
});

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function runLogLine(message: string): string {
  return `${new Date().toISOString()} ${message}`;
}

function failedRun(
  runId: string,
  sourcePath: string,
  evidence: string[],
  worktree?: { path: string; branch: string },
  changedFiles: string[] = []
): LoopRun {
  return {
    id: runId,
    runtime: "pi",
    sourcePath,
    status: "failed",
    worktreePath: worktree?.path,
    branchName: worktree?.branch,
    changedFiles,
    eval: {
      status: "failed",
      evidence
    }
  };
}

async function runCascadePipeline(sourcePath: string, model?: string): Promise<LoopRun> {
  const provisionalRunId = `run-${Date.now()}`;
  const evidence: string[] = [];
  const sessionDir = join(defaultWorkspace, ".sloop", "pi-sessions", provisionalRunId);
  let worktree: { path: string; branch: string };

  try {
    worktree = await createRunWorktree(defaultWorkspace, provisionalRunId, sourcePath);
    evidence.push(`Created worktree ${worktree.path} on ${worktree.branch}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worktree error";
    evidence.push(`Worktree creation failed: ${message}`);
    return upsertRun(
      defaultWorkspace,
      failedRun(provisionalRunId, sourcePath, evidence, undefined, [])
    );
  }

  try {
    const run = await runPiCascade({
      workspaceRoot: worktree.path,
      sourcePath,
      runId: provisionalRunId,
      model,
      sessionDir
    });
    const changedFiles = run.changedFiles;
    const evalResult: EvalResult = {
      ...run.eval,
      evidence: [...evidence, ...run.eval.evidence]
    };
    const status: DocStatus = run.status === "passed" && evalResult.status === "passed" ? "passed" : "failed";
    let archived = false;

    if (worktree && status === "passed") {
      const applied = await applyWorktreeChanges({
        workspaceRoot: defaultWorkspace,
        worktreePath: worktree.path,
        changedFiles
      });
      evalResult.evidence.push(
        `Applied ${applied.appliedFiles.length} file(s) from worktree: ${applied.appliedFiles.join(", ") || "none"}.`
      );
      if (applied.skippedFiles.length > 0) {
        evalResult.evidence.push(`Skipped ${applied.skippedFiles.length} file(s): ${applied.skippedFiles.join(", ")}.`);
      }
      await cleanupWorktree(defaultWorkspace, worktree.path);
      evalResult.evidence.push(`Cleaned up worktree ${worktree.path}.`);
    } else if (worktree) {
      const archive = await archiveWorktreeRun({
        workspaceRoot: defaultWorkspace,
        runId: run.id,
        worktreePath: worktree.path,
        branch: worktree.branch,
        sourcePath,
        changedFiles,
        reason: `Pi cascade ${status}; changes were archived instead of applied.`
      });
      archived = true;
      evalResult.evidence.push(`Archived failed worktree changes at ${archive.markerPath}.`);
    }

    await appendHistory(defaultWorkspace, {
      id: run.id,
      kind: "cascade",
      title: status === "passed" ? "Pi cascade passed evaluation" : "Pi cascade failed evaluation",
      createdAt: new Date().toISOString(),
      sourcePath,
      changedFiles,
      status,
      summary:
        status === "passed"
          ? `Pi updated ${changedFiles.length} affected file(s) and passed eval.`
          : `Pi cascade did not pass eval: ${evalResult.evidence.join(" ")}`
    });

    return upsertRun(defaultWorkspace, {
      ...run,
      status,
      worktreePath: worktree?.path,
      branchName: worktree?.branch,
      changedFiles,
      eval: evalResult,
      archived,
      log: evidence.map(runLogLine)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Pi cascade error";
    evidence.push(`Pi cascade failed: ${message}`);
    const changedFiles: string[] = [];
    const run = failedRun(provisionalRunId, sourcePath, evidence, worktree, changedFiles);

    if (worktree) {
      try {
        const archive = await archiveWorktreeRun({
          workspaceRoot: defaultWorkspace,
        runId: provisionalRunId,
        worktreePath: worktree.path,
          branch: worktree.branch,
          sourcePath,
          changedFiles,
          reason: message
        });
        run.eval.evidence.push(`Archived failed worktree changes at ${archive.markerPath}.`);
      } catch (archiveError) {
        run.eval.evidence.push(
          `Failed to archive worktree changes: ${
            archiveError instanceof Error ? archiveError.message : "Unknown archive error"
          }`
        );
      }
    }

    return upsertRun(defaultWorkspace, { ...run, archived: Boolean(worktree), log: evidence.map(runLogLine) });
  }
}

app.get("/api/runs", async (_request, response, next) => {
  try {
    response.json(await readRuns(defaultWorkspace));
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs/pi-cascade", async (request, response, next) => {
  try {
    const sourcePath = requiredSourcePath(request.body?.sourcePath);
    const model = typeof request.body?.model === "string" ? request.body.model : undefined;
    response.json(await runCascadePipeline(sourcePath, model));
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs", async (request, response, next) => {
  try {
    const sourcePath = requiredSourcePath(request.body?.sourcePath);
    const model = typeof request.body?.model === "string" ? request.body.model : undefined;
    response.json(await runCascadePipeline(sourcePath, model));
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs/pause", async (request, response, next) => {
  try {
    const runId = typeof request.body?.runId === "string" ? request.body.runId : undefined;
    const sourcePath = typeof request.body?.sourcePath === "string" ? request.body.sourcePath : undefined;
    const run = runId ? await updateRunStatus(defaultWorkspace, runId, "paused") : undefined;
    if (runId) await appendRunLog(defaultWorkspace, runId, runLogLine("Run paused."));
    const loop = sourcePath ? await pauseLoop(defaultWorkspace, sourcePath) : undefined;

    response.json({
      id: run?.id ?? runId ?? loop?.history.id ?? `pause-${Date.now()}`,
      status: "paused",
      run,
      doc: loop?.doc,
      history: loop?.history
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs/resume", async (request, response, next) => {
  try {
    const runId = typeof request.body?.runId === "string" ? request.body.runId : undefined;
    const sourcePath = typeof request.body?.sourcePath === "string" ? request.body.sourcePath : undefined;
    const run = runId ? await updateRunStatus(defaultWorkspace, runId, "running") : undefined;
    if (runId) await appendRunLog(defaultWorkspace, runId, runLogLine("Run resumed."));
    const loop = sourcePath ? await resumeLoop(defaultWorkspace, sourcePath) : undefined;

    response.json({
      id: run?.id ?? runId ?? loop?.history.id ?? `resume-${Date.now()}`,
      status: "running",
      run,
      doc: loop?.doc,
      history: loop?.history
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/eval", async (request, response, next) => {
  try {
    const changedFiles = stringList(request.body?.changedFiles);
    const sourcePath = typeof request.body?.sourcePath === "string" ? request.body.sourcePath : undefined;
    const result = runEvaluation({
      runtime: "pi",
      changedFiles,
      criteria: Array.isArray(request.body?.criteria) ? request.body.criteria : undefined,
      commands: Array.isArray(request.body?.commands) ? request.body.commands : undefined,
      spec: request.body?.spec
    });

    if (sourcePath) {
      await appendHistory(defaultWorkspace, {
        id: `eval-${Date.now()}`,
        kind: "eval",
        title: result.status === "passed" ? "Evaluation passed" : "Evaluation failed",
        createdAt: new Date().toISOString(),
        sourcePath,
        changedFiles,
        status: result.status,
        summary: result.evidence.join(" ")
      });
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/cascade-plan", async (request, response, next) => {
  try {
    const sourcePath = requiredSourcePath(request.query.sourcePath);
    const docs = await listDocs(defaultWorkspace);
    const diffs = await getGitDiff(defaultWorkspace);
    const plan = planCascade({ docs, sourcePath, diffs });

    response.json({
      ...plan,
      summary: summarizeAffectedDocsForPi(plan)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", async (_request, response, next) => {
  try {
    response.json(await readHistory(defaultWorkspace));
  } catch (error) {
    next(error);
  }
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction
  ) => {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  }
);

app.listen(port, "127.0.0.1", () => {
  console.log(`Sloop server running at http://127.0.0.1:${port}`);
});
