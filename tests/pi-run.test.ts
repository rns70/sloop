import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSampleWorkspace } from "../server/lib/sampleWorkspace.js";
import { runSimulatedPiCascade } from "../server/lib/runs.js";
import { readHistory } from "../server/lib/history.js";
import { planCascade } from "../server/lib/cascade.js";
import { runEvaluation } from "../server/lib/evaluation.js";
import { createRunBranchName } from "../server/lib/worktrees.js";
import { listDocs } from "../server/lib/workspace.js";

describe("Pi cascade", () => {
  it("updates downstream docs, passes eval, and records history", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-pi-run-"));
    await ensureSampleWorkspace(workspaceRoot);

    const result = await runSimulatedPiCascade({
      workspaceRoot,
      sourcePath: "sample-workspace/PRD.md"
    });

    expect(result.status).toBe("passed");
    expect(result.changedFiles).toContain("sample-workspace/architecture/auth-a.md");
    expect(result.changedFiles).toContain("sample-workspace/plans/auth-session.md");
    expect(result.eval.status).toBe("passed");

    const architecture = await readFile(
      join(workspaceRoot, "sample-workspace/architecture/auth-a.md"),
      "utf8"
    );
    expect(architecture).toContain("Sessions expire after 30 days");

    const history = await readHistory(workspaceRoot);
    expect(history[0]?.kind).toBe("cascade");
    expect(history[0]?.changedFiles).toEqual(result.changedFiles);
  });
});

describe("server-side helper modules", () => {
  it("plans affected child stage docs from changed loop docs", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-cascade-plan-"));
    await ensureSampleWorkspace(workspaceRoot);

    const docs = await listDocs(workspaceRoot);
    const plan = planCascade({
      docs,
      sourcePath: "sample-workspace/PRD.md",
      changedPaths: ["sample-workspace/PRD.md"]
    });

    expect(plan.affectedDocs.map((doc) => doc.path)).toEqual([
      "sample-workspace/architecture/auth-a.md",
      "sample-workspace/plans/auth-session.md"
    ]);
  });

  it("evaluates Pi runs and fails empty changes", () => {
    expect(runEvaluation({ runtime: "pi", changedFiles: ["sample-workspace/PRD.md"] })).toEqual({
      status: "passed",
      evidence: ["Pi evaluation accepted 1 changed file: sample-workspace/PRD.md"]
    });

    expect(runEvaluation({ runtime: "pi", changedFiles: [] }).status).toBe("failed");
  });

  it("creates safe run branch names", () => {
    expect(createRunBranchName("run 123", "sample-workspace/PRD.md")).toBe(
      "sloop/run/run-123-sample-workspace-prd-md"
    );
  });
});
