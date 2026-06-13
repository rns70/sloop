import { complete } from '@earendil-works/pi-ai';
import type { Api, Context, Model } from '@earendil-works/pi-ai';
import type {
  DatabankDiff,
  FilesService,
  ResolvedModel,
  RoleDef,
  WorkflowDef,
} from '../../shared/index';
import { resolveModel } from '../../shared/index';
import {
  buildArchitectPrompt,
  parseArchitectResponse,
  type ArchitectPlan,
  type ArchitectPromptParts,
} from './prompt';

/**
 * The architecture loop: turn a databank diff + process workflow into a proposed
 * tree of leaf loops, by calling a big planner model **provider-agnostically**
 * through `@earendil-works/pi-ai`. No provider SDK is touched directly — the
 * registry maps an alias to `{ provider, id, baseUrl, apiKey }` and Pi handles
 * dispatch, so the architect can plan on Claude or NVIDIA Nemotron with identical
 * code.
 */

export interface ArchitectInput {
  cascadeId: string;
  diff: DatabankDiff;
  workflow: WorkflowDef;
  roles: RoleDef[];
}

export interface ArchitectPlanner {
  propose(input: ArchitectInput): Promise<ArchitectPlan>;
}

/**
 * The model call, injectable so tests can stand in a fake without a network round
 * trip. The default implementation calls Pi's `complete` with a `Model` built from
 * the resolved registry entry.
 */
export type ArchitectModelCall = (
  resolved: ResolvedModel,
  parts: ArchitectPromptParts,
) => Promise<string>;

export interface ArchitectDeps {
  files: FilesService;
  env?: NodeJS.ProcessEnv;
  /** Override the model call (tests inject a fake). Defaults to the Pi-backed call. */
  call?: ArchitectModelCall;
  /** Cap on proposed leaves — keeps the tree small. Defaults to `SLOOP_MAX_LEAVES` or 6. */
  maxLeaves?: number;
}

const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** Build a Pi `Model` from a resolved registry entry — the one provider boundary. */
export function toPiModel(resolved: ResolvedModel): Model<Api> {
  const base = {
    id: resolved.id,
    name: resolved.id,
    input: ['text'] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  if (resolved.provider === 'anthropic') {
    return {
      ...base,
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: resolved.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL,
      reasoning: true,
      contextWindow: 200_000,
      maxTokens: 8_192,
    };
  }

  // nebius (NVIDIA Nemotron et al.) is registered as an OpenAI-compatible provider.
  if (!resolved.baseUrl) {
    throw new Error(
      `Provider "${resolved.provider}" requires a baseUrl in the model registry (OpenAI-compatible endpoint).`,
    );
  }
  return {
    ...base,
    api: 'openai-completions',
    provider: resolved.provider,
    baseUrl: resolved.baseUrl,
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

/** Default Pi-backed architect call. */
const piArchitectCall: ArchitectModelCall = async (resolved, parts) => {
  const model = toPiModel(resolved);
  const context: Context = {
    systemPrompt: parts.systemPrompt,
    messages: [{ role: 'user', content: parts.userPrompt, timestamp: Date.now() }],
  };
  const message = await complete(model, context, { apiKey: resolved.apiKey, maxTokens: 4_096 });
  const text = message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) {
    throw new Error(
      `Architect model "${resolved.id}" returned no text (stopReason: ${message.stopReason}).`,
    );
  }
  return text;
};

/**
 * Pick the planner alias: explicit `SLOOP_PLANNER_MODEL` env override → the
 * workflow's architect/plan step default → the first step → `opus`. Expensive
 * reasoning belongs at the root (§6.3).
 */
export function pickPlannerAlias(env: NodeJS.ProcessEnv, workflow: WorkflowDef): string {
  const fromEnv = env.SLOOP_PLANNER_MODEL?.trim();
  if (fromEnv) return fromEnv;
  const architectStage =
    workflow.steps.find((s) => s.role === 'architect') ??
    workflow.steps.find((s) => s.name === 'plan');
  if (architectStage?.model) return architectStage.model;
  return workflow.steps[0]?.model ?? 'opus';
}

function parseMaxLeaves(env: NodeJS.ProcessEnv, override: number | undefined): number {
  if (typeof override === 'number' && override > 0) return Math.floor(override);
  const fromEnv = Number.parseInt(env.SLOOP_MAX_LEAVES ?? '', 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 6;
}

/**
 * Create an architect planner. Resolves the planner model from the registry on
 * every `propose` so a hot-edited `.sloop/config.md` takes effect without restart.
 */
export function createArchitect(deps: ArchitectDeps): ArchitectPlanner {
  const env = deps.env ?? process.env;
  const call = deps.call ?? piArchitectCall;
  const maxLeaves = parseMaxLeaves(env, deps.maxLeaves);

  return {
    async propose(input: ArchitectInput): Promise<ArchitectPlan> {
      const registry = await deps.files.readModelRegistry();
      const plannerAlias = pickPlannerAlias(env, input.workflow);
      const resolved = resolveModel(plannerAlias, registry, env);

      const parts = buildArchitectPrompt(input.diff, input.workflow, input.roles, maxLeaves);
      const raw = await call(resolved, parts);

      return parseArchitectResponse(raw, {
        plannerAlias,
        workflow: input.workflow,
        roles: input.roles,
        maxLeaves,
      });
    },
  };
}
