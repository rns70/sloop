import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const prd = `---
loop:
  id: prd-auth
  type: prd
  status: passing
  autoApply: true
  stages:
    - id: auth-architecture-a
      title: Auth architecture A
      doc: sample-workspace/architecture/auth-a.md
      status: evaluating
      agent: pi
    - id: auth-architecture-b
      title: Auth architecture B
      doc: sample-workspace/architecture/auth-b.md
      status: archived
      agent: pi
    - id: auth-session-plan
      title: Auth session plan
      doc: sample-workspace/plans/auth-session.md
      status: passed
      agent: pi
evals:
  - Every authentication requirement has a downstream architecture decision.
  - Every session behavior has an implementation plan with deterministic tests.
---
# Authentication Requirements

Users can sign in, maintain a session, and recover access without creating support burden or weakening account security.

## Requirement: Sessions

Sessions must be long enough for normal product use and short enough to limit stale access risk.
`;

const architecture = `---
loop:
  id: auth-architecture-a
  type: architecture
  status: evaluating
  autoApply: true
  stages:
    - id: auth-session-plan
      title: Auth session plan
      doc: sample-workspace/plans/auth-session.md
      status: passed
      agent: pi
evals:
  - Architecture covers the session requirement.
---
# Auth Architecture A

Session expiry TBD.
`;

const archivedArchitecture = `---
loop:
  id: auth-architecture-b
  type: architecture
  status: archived
  autoApply: false
  stages: []
evals:
  - Alternative was evaluated and archived.
---
# Auth Architecture B

Archived alternative.
`;

const plan = `---
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
`;

export async function ensureSampleWorkspace(workspaceRoot: string): Promise<void> {
  await mkdir(join(workspaceRoot, "sample-workspace/architecture"), { recursive: true });
  await mkdir(join(workspaceRoot, "sample-workspace/plans"), { recursive: true });
  await writeFile(join(workspaceRoot, "sample-workspace/PRD.md"), prd, "utf8");
  await writeFile(join(workspaceRoot, "sample-workspace/architecture/auth-a.md"), architecture, "utf8");
  await writeFile(
    join(workspaceRoot, "sample-workspace/architecture/auth-b.md"),
    archivedArchitecture,
    "utf8"
  );
  await writeFile(join(workspaceRoot, "sample-workspace/plans/auth-session.md"), plan, "utf8");
}
