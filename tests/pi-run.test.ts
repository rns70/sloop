import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPiCascade } from "../server/lib/runs.js";
import { planCascade } from "../server/lib/cascade.js";
import { runEvaluation } from "../server/lib/evaluation.js";
import { createPiAgentAdapter } from "../server/lib/piRuntime.js";
import { materializeCodeStageControllers, materializeDefaultCascadeForSource } from "../server/lib/stageControllers.js";
import { listDocs } from "../server/lib/workspace.js";
import type { AgentAdapter } from "../src/shared/types.js";

const prdPath = "loops/PRD.md";
const architecturePath = "loops/architecture/auth-a.md";
const planPath = "loops/plans/auth-session.md";

async function createLoopWorkspace(workspaceRoot: string): Promise<void> {
  await mkdir(join(workspaceRoot, "loops/architecture"), { recursive: true });
  await mkdir(join(workspaceRoot, "loops/plans"), { recursive: true });
  await writeFile(
    join(workspaceRoot, prdPath),
    `---
loop:
  id: prd-auth
  type: prd
  status: passing
  autoApply: true
  stages:
    - id: auth-architecture-a
      title: Auth architecture A
      doc: ${architecturePath}
      status: evaluating
      agent: pi
    - id: auth-session-plan
      title: Auth session plan
      doc: ${planPath}
      status: passed
      agent: pi
evals:
  - Every authentication requirement has a downstream architecture decision.
---
# Authentication Requirements

Sessions must be covered.
`,
    "utf8"
  );
  await writeFile(
    join(workspaceRoot, architecturePath),
    `---
loop:
  id: auth-architecture-a
  type: architecture
  status: evaluating
  autoApply: true
  stages:
    - id: auth-session-plan
      title: Auth session plan
      doc: ${planPath}
      status: passed
      agent: pi
evals:
  - Architecture covers the session requirement.
---
# Auth Architecture A

Session expiry TBD.
`,
    "utf8"
  );
  await writeFile(
    join(workspaceRoot, planPath),
    `---
loop:
  id: auth-session-plan
  type: implementation-plan
  status: passed
  autoApply: true
  stages: []
evals:
  - Implementation includes deterministic tests.
---
# Auth Session Plan

Refresh behavior unspecified.
`,
    "utf8"
  );
}

describe("Pi cascade", () => {
  it("runs through the Pi adapter seam and preserves a provided run id", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-pi-run-"));
    await createLoopWorkspace(workspaceRoot);
    const adapter: AgentAdapter = {
      runtime: "pi",
      async run(input) {
        return {
          id: "adapter-run-id",
          runtime: "pi",
          sourcePath: input.sourcePath,
          status: "passed",
          changedFiles: [architecturePath, planPath],
          eval: {
            status: "passed",
            evidence: [`Adapter saw ${input.workspaceRoot}`]
          }
        };
      }
    };

    const result = await runPiCascade({
      workspaceRoot,
      sourcePath: prdPath,
      runId: "stable-run-id",
      adapter
    });

    expect(result.id).toBe("stable-run-id");
    expect(result.status).toBe("passed");
    expect(result.changedFiles).toContain(architecturePath);
    expect(result.changedFiles).toContain(planPath);
    expect(result.eval.status).toBe("passed");
    expect(result.eval.evidence).toEqual([`Adapter saw ${workspaceRoot}`]);
  });
});

describe("server-side helper modules", () => {
  it("plans affected child stage docs from changed loop docs", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-cascade-plan-"));
    await createLoopWorkspace(workspaceRoot);

    const docs = await listDocs(workspaceRoot);
    const plan = planCascade({
      docs,
      sourcePath: prdPath,
      changedPaths: [prdPath]
    });

    expect(plan.affectedDocs.map((doc) => doc.path)).toEqual([architecturePath, planPath]);
  });

  it("evaluates Pi runs and fails empty changes", () => {
    expect(runEvaluation({ runtime: "pi", changedFiles: [prdPath] })).toEqual({
      status: "passed",
      evidence: [`Pi evaluation accepted 1 changed file: ${prdPath}`]
    });

    expect(runEvaluation({ runtime: "pi", changedFiles: [] }).status).toBe("failed");
  });

  it("materializes missing code stage controller docs", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-code-controller-"));
    await mkdir(join(workspaceRoot, "loops/plans"), { recursive: true });
    await writeFile(
      join(workspaceRoot, "loops/plans/auth-session.md"),
      `---
loop:
  id: auth-session-plan
  type: implementation-plan
  status: running
  autoApply: true
  stages:
    - id: build-auth-session
      kind: code
      title: Build auth session
      outputs:
        - src/auth/**
        - tests/auth/**
      eval:
        commands:
          - npm test -- auth
evals:
  - The build stage preserves the auth plan.
---
# Auth Session Plan

Build auth session handling.
`,
      "utf8"
    );

    const result = await materializeCodeStageControllers(workspaceRoot);
    const controllerPath = "loops/build/build-auth-session.md";
    const controller = await readFile(join(workspaceRoot, controllerPath), "utf8");
    const docs = await listDocs(workspaceRoot);
    const plan = planCascade({
      docs,
      sourcePath: "loops/plans/auth-session.md",
      changedPaths: ["loops/plans/auth-session.md"]
    });

    expect(result.createdPaths).toEqual([controllerPath]);
    expect(controller).toContain("type: code");
    expect(controller).toContain("src/auth/**");
    expect(controller).toContain("npm test -- auth");
    expect(controller).toContain("Parent: loops/plans/auth-session.md");
    expect(plan.affectedDocs.map((doc) => doc.path)).toEqual([controllerPath]);
  });

  it("bootstraps a default doc-to-code cascade for a plain top-level request", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-default-cascade-"));
    await mkdir(join(workspaceRoot, "loops"), { recursive: true });
    await writeFile(join(workspaceRoot, "loops/PRD.md"), "create pacman\n", "utf8");

    const result = await materializeDefaultCascadeForSource(workspaceRoot, "loops/PRD.md");
    const docs = await listDocs(workspaceRoot);
    const source = docs.find((doc) => doc.path === "loops/PRD.md");
    const plan = planCascade({
      docs,
      sourcePath: "loops/PRD.md",
      changedPaths: ["loops/PRD.md"]
    });

    expect(result.createdPaths).toEqual([
      "loops/architecture/create-pacman-architecture.md",
      "loops/plans/create-pacman-plan.md",
      "loops/build/build-create-pacman.md"
    ]);
    expect(source?.body).toBe("create pacman\n");
    expect(source?.stages[0]?.doc).toBe("loops/architecture/create-pacman-architecture.md");
    expect(plan.affectedDocs.map((doc) => doc.path)).toEqual([
      "loops/architecture/create-pacman-architecture.md",
      "loops/plans/create-pacman-plan.md",
      "loops/build/build-create-pacman.md"
    ]);
  });

  it("retries Pi with eval evidence until command eval passes and captures code outputs", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-code-loop-"));
    await mkdir(join(workspaceRoot, "loops/plans"), { recursive: true });
    await writeFile(
      join(workspaceRoot, "loops/plans/auth-session.md"),
      `---
loop:
  id: auth-session-plan
  type: implementation-plan
  status: running
  autoApply: true
  stages:
    - id: build-auth-session
      kind: code
      title: Build auth session
      outputs:
        - src/auth/**
      eval:
        commands:
          - npm test -- auth
evals:
  - Auth sessions expire deterministically.
---
# Auth Session Plan

Build auth session handling.
`,
      "utf8"
    );
    const fakePiPath = join(workspaceRoot, "fake-pi.mjs");
    await writeFile(
      fakePiPath,
      `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
let attempt = 1;
try {
  attempt = Number(readFileSync("attempt.txt", "utf8")) + 1;
} catch {
  attempt = 1;
}
writeFileSync("attempt.txt", String(attempt));
writeFileSync(\`prompt-\${attempt}.txt\`, prompt);
mkdirSync("src/auth", { recursive: true });
writeFileSync("src/auth/session.ts", \`export const attempt = \${attempt};\\n\`);
`,
      "utf8"
    );

    let evalAttempts = 0;
    const adapter = createPiAgentAdapter({
      command: process.execPath,
      args: [fakePiPath, "--print", "--no-approve", "--no-session", "--model", "fake"],
      maxAttempts: 2,
      executor: async () => {
        evalAttempts += 1;
        return evalAttempts === 1
          ? { status: "failed", evidence: ["session expiry test failed"] }
          : { status: "passed", evidence: ["session expiry test passed"] };
      }
    });

    const run = await adapter.run({
      workspaceRoot,
      sourcePath: "loops/plans/auth-session.md",
      runId: "retry-run"
    });
    const secondPrompt = await readFile(join(workspaceRoot, "prompt-2.txt"), "utf8");

    expect(evalAttempts).toBe(2);
    expect(run.status).toBe("passed");
    expect(run.changedFiles).toContain("loops/build/build-auth-session.md");
    expect(run.changedFiles).toContain("src/auth/session.ts");
    expect(run.eval.evidence).toContain("session expiry test passed");
    expect(secondPrompt).toContain("Previous evaluation failed");
    expect(secondPrompt).toContain("session expiry test failed");
  });
});
