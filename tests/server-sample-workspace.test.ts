import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

let server: ChildProcessWithoutNullStreams | undefined;

function stopServer() {
  if (!server || server.killed) return;
  server.kill();
  server = undefined;
}

async function startServer(workspaceRoot: string): Promise<string> {
  const port = 5000 + Math.floor(Math.random() * 1000);
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SLOOP_SERVER_PORT: String(port),
      SLOOP_WORKSPACE: workspaceRoot
    }
  });

  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${origin}/api/workspace`);
      return origin;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error(`Server did not start. ${stderr}`);
}

afterEach(() => {
  stopServer();
});

describe("workspace project endpoints", () => {
  it("creates a starter project and switches the active workspace", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-empty-workspace-"));
    const projectRoot = join(workspaceRoot, "new-project");
    const origin = await startServer(workspaceRoot);

    const response = await fetch(`${origin}/api/workspace/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectRoot })
    });
    const workspace = await response.json() as { root: string; docs: Array<{ path: string }> };

    expect(response.status).toBe(200);
    expect(workspace.root).toBe(projectRoot);
    expect(workspace.docs.map((doc) => doc.path)).toEqual([
      "loops/architecture/architecture.md",
      "loops/plans/implementation-plan.md",
      "loops/PRD.md"
    ]);
  });

  it("opens an existing workspace folder", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-open-base-"));
    const otherRoot = await mkdtemp(join(tmpdir(), "sloop-open-other-"));
    await mkdir(join(otherRoot, "loops"), { recursive: true });
    await writeFile(
      join(otherRoot, "loops", "PRD.md"),
      `---
loop:
  id: prd
  type: prd
  status: idle
  autoApply: true
  stages: []
---
# Other PRD
`,
      "utf8"
    );
    const origin = await startServer(workspaceRoot);

    const response = await fetch(`${origin}/api/workspace/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: otherRoot })
    });
    const workspace = await response.json() as { root: string; docs: Array<{ title: string }> };

    expect(response.status).toBe(200);
    expect(workspace.root).toBe(otherRoot);
    expect(workspace.docs[0]?.title).toBe("Other PRD");
  });

  it("returns a clear error when opening a missing folder", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-open-missing-"));
    const missingRoot = join(workspaceRoot, "missing-project");
    const origin = await startServer(workspaceRoot);

    const response = await fetch(`${origin}/api/workspace/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: missingRoot })
    });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toContain(`Workspace folder does not exist: ${missingRoot}`);
  });
});
