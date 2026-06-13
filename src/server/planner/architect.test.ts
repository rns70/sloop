import { describe, it, expect, vi } from 'vitest';
import type {
  AdrDoc,
  DatabankDiff,
  FilesService,
  LoopDoc,
  ModelRegistry,
  RoleDef,
  TemplateDef,
} from '../../shared/index';
import type { ResolvedModel } from '../../shared/index';
import { buildArchitectPrompt, parseArchitectResponse, type ArchitectPromptParts } from './prompt';
import { createArchitect, pickPlannerAlias, toPiModel } from './architect';

const template: TemplateDef = {
  id: 'spec-driven',
  name: 'Spec-driven',
  stages: [
    { name: 'plan', role: 'architect', model: 'opus' },
    { name: 'implement', role: 'engineer', model: 'haiku' },
    { name: 'verify', role: 'qa', model: 'sonnet' },
  ],
  guidance: 'plan → implement → verify. Keep the tree shallow.',
};

const roles: RoleDef[] = [
  { id: 'engineer', name: 'Engineer', defaultModel: 'haiku', brief: 'Make the change.' },
  { id: 'qa', name: 'QA', defaultModel: 'sonnet', brief: 'Confirm criteria pass.' },
];

const diff: DatabankDiff = {
  changed: [
    {
      relPath: 'databank/adr-007-token-rotation.md',
      delta: 'change',
      before: 'rotation only',
      after: 'rotation + reuse detection',
    },
  ],
};

const registry: ModelRegistry = {
  models: {
    opus: { provider: 'anthropic', id: 'claude-opus-4-8' },
    haiku: { provider: 'anthropic', id: 'claude-haiku-4-5-20251001' },
    nemotron: { provider: 'nebius', id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
  },
  providers: {
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
    nebius: { baseUrl: 'https://api.studio.nebius.ai/v1', apiKeyEnv: 'NEBIUS_API_KEY' },
  },
};

/** Minimal FilesService fake — only readModelRegistry is exercised by the planner. */
function fakeFiles(): FilesService {
  return {
    listAdrs: async () => [],
    readAdr: async () => ({}) as AdrDoc,
    writeAdr: async () => {},
    readLoop: async () => ({}) as LoopDoc,
    writeLoop: async () => {},
    listLoops: async () => [],
    listCascadeIds: async () => [],
    listTemplates: async () => [template],
    listRoles: async () => roles,
    readModelRegistry: async () => registry,
  };
}

const validResponse = JSON.stringify({
  summary: 'Two engineering leaves plus a security review.',
  leaves: [
    {
      id: 'rotate-refresh-tokens',
      role: 'engineer',
      model: 'haiku',
      delta: 'change',
      sourceAdr: 'adr-007',
      brief: 'Rotate refresh tokens on every use.',
      acceptanceCriteria: [
        { id: 'ac-1', text: 'Tokens rotate ≤15m', verify: 'npm test -- rotation' },
      ],
    },
    {
      id: 'invalidate-on-reuse',
      role: 'engineer',
      brief: 'Reject reused tokens.',
      acceptanceCriteria: [{ id: 'ac-2', text: 'Reused token revokes session' }],
    },
  ],
});

describe('buildArchitectPrompt', () => {
  it('includes the template, roles, diff and leaf cap', () => {
    const { systemPrompt, userPrompt } = buildArchitectPrompt(diff, template, roles, 4);
    expect(systemPrompt).toContain('at most 4 leaves');
    expect(systemPrompt).toContain('convergence invariant');
    expect(userPrompt).toContain('Spec-driven');
    expect(userPrompt).toContain('engineer');
    expect(userPrompt).toContain('adr-007-token-rotation.md');
    expect(userPrompt).toContain('rotation + reuse detection');
  });
});

describe('parseArchitectResponse', () => {
  const opts = { plannerAlias: 'opus', template, roles, maxLeaves: 6 };

  it('parses a valid response and defaults a missing leaf model from role/template', () => {
    const plan = parseArchitectResponse(validResponse, opts);
    expect(plan.plannerAlias).toBe('opus');
    expect(plan.leaves).toHaveLength(2);
    expect(plan.leaves[0].model).toBe('haiku');
    // Second leaf omitted model -> engineer's stage/role default 'haiku'.
    expect(plan.leaves[1].model).toBe('haiku');
    expect(plan.leaves[1].acceptanceCriteria[0].verify).toBeUndefined();
  });

  it('tolerates markdown code fences around the JSON', () => {
    const fenced = '```json\n' + validResponse + '\n```';
    expect(parseArchitectResponse(fenced, opts).leaves).toHaveLength(2);
  });

  it('throws on non-JSON output', () => {
    expect(() => parseArchitectResponse('I cannot help with that.', opts)).toThrow(/JSON/);
  });

  it('throws on an empty leaves array', () => {
    expect(() => parseArchitectResponse('{"leaves":[]}', opts)).toThrow(/non-empty/);
  });

  it('rejects duplicate leaf ids', () => {
    const dup = JSON.stringify({
      leaves: [
        { id: 'x', brief: 'a', acceptanceCriteria: [] },
        { id: 'x', brief: 'b', acceptanceCriteria: [] },
      ],
    });
    expect(() => parseArchitectResponse(dup, opts)).toThrow(/Duplicate/);
  });

  it('clamps the leaf count to maxLeaves', () => {
    const many = JSON.stringify({
      leaves: Array.from({ length: 5 }, (_, i) => ({
        id: `leaf-${i}`,
        role: 'engineer',
        brief: 'x',
        acceptanceCriteria: [],
      })),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plan = parseArchitectResponse(many, { ...opts, maxLeaves: 2 });
    expect(plan.leaves).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('pickPlannerAlias', () => {
  it('prefers the SLOOP_PLANNER_MODEL env override', () => {
    expect(
      pickPlannerAlias({ SLOOP_PLANNER_MODEL: 'nemotron' } as NodeJS.ProcessEnv, template),
    ).toBe('nemotron');
  });

  it('falls back to the architect stage model', () => {
    expect(pickPlannerAlias({} as NodeJS.ProcessEnv, template)).toBe('opus');
  });
});

describe('toPiModel', () => {
  it('maps an anthropic entry to the anthropic-messages API', () => {
    const m = toPiModel({ provider: 'anthropic', id: 'claude-opus-4-8', apiKey: 'k' });
    expect(m.api).toBe('anthropic-messages');
    expect(m.baseUrl).toContain('anthropic');
  });

  it('maps a nebius entry to the openai-completions API with its baseUrl', () => {
    const m = toPiModel({
      provider: 'nebius',
      id: 'nvidia/llama-3.1-nemotron-70b-instruct',
      baseUrl: 'https://api.studio.nebius.ai/v1',
      apiKey: 'k',
    });
    expect(m.api).toBe('openai-completions');
    expect(m.baseUrl).toBe('https://api.studio.nebius.ai/v1');
  });

  it('throws when an OpenAI-compatible provider lacks a baseUrl', () => {
    expect(() => toPiModel({ provider: 'nebius', id: 'x', apiKey: 'k' })).toThrow(/baseUrl/);
  });
});

describe('createArchitect', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-ant', NEBIUS_API_KEY: 'nbk' } as NodeJS.ProcessEnv;

  it('resolves the planner model and returns a parsed plan', async () => {
    const call = vi.fn(async (_resolved: ResolvedModel, _parts: ArchitectPromptParts) => validResponse);
    const planner = createArchitect({ files: fakeFiles(), env, call });
    const plan = await planner.propose({ cascadeId: 'c1', diff, template, roles });

    expect(plan.leaves).toHaveLength(2);
    expect(plan.plannerAlias).toBe('opus');
    // The call received the resolved Anthropic model (opus) + built prompt parts.
    const [resolved, parts] = call.mock.calls[0];
    expect(resolved.id).toBe('claude-opus-4-8');
    expect(parts.userPrompt).toContain('adr-007');
  });

  it('plans on Nemotron when SLOOP_PLANNER_MODEL points at nebius', async () => {
    const call = vi.fn(async (_resolved: ResolvedModel, _parts: ArchitectPromptParts) => validResponse);
    const planner = createArchitect({
      files: fakeFiles(),
      env: { ...env, SLOOP_PLANNER_MODEL: 'nemotron' } as NodeJS.ProcessEnv,
      call,
    });
    await planner.propose({ cascadeId: 'c1', diff, template, roles });
    const [resolved] = call.mock.calls[0];
    expect(resolved.provider).toBe('nebius');
    expect(resolved.id).toContain('nemotron');
  });
});
