import { mkdtemp } from "node:fs/promises";
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

describe("sample workspace endpoint", () => {
  it("is not available because workspaces are no longer seeded from sample content", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "sloop-empty-workspace-"));
    const origin = await startServer(workspaceRoot);

    const response = await fetch(`${origin}/api/sample-workspace`, { method: "POST" });

    expect(response.status).toBe(404);
  });
});
