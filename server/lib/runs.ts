import type { AgentAdapter, AgentRunInput, LoopRun } from "../../src/shared/types.js";
import { createPiAgentAdapter } from "./piRuntime.js";

export interface PiCascadeInput extends AgentRunInput {
  adapter?: AgentAdapter;
  runId?: string;
  model?: string;
  provider?: string;
  sessionDir?: string;
}

export async function runPiCascade(input: PiCascadeInput): Promise<LoopRun> {
  const adapter =
    input.adapter ??
    createPiAgentAdapter({
      model: input.model,
      provider: input.provider,
      sessionDir: input.sessionDir
    });
  const run = await adapter.run(input);
  return input.runId ? { ...run, id: input.runId } : run;
}
