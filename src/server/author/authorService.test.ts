import { describe, it, expect } from 'vitest';
import type { AuthorRequest, ModelRegistry, ResolvedModel } from '../../shared/index';
import type { AuthorFiles, AuthorModelCall } from './authorService';
import { createAuthorService } from './authorService';
import { buildAuthorPrompt, pickAuthorAlias } from './prompt';

const registry: ModelRegistry = {
  models: {
    sonnet: { provider: 'anthropic', id: 'claude-sonnet-4-6' },
    haiku: { provider: 'anthropic', id: 'claude-haiku-4-5-20251001' },
    nemotron: { provider: 'nebius', id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
  },
  providers: {
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
    nebius: { baseUrl: 'https://api.studio.nebius.ai/v1', apiKeyEnv: 'NEBIUS_API_KEY' },
  },
};

const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'test-key', NEBIUS_API_KEY: 'nebius-key' };

const DOCS: Record<string, string> = {
  'databank/adr-007.md': '# Token rotation\n\nRotate tokens every 24h.',
  'databank/adr-012.md': '# Rate limiting\n\nLimit to 100 req/min per key.',
};

/** Fake AuthorFiles: serves canned doc bodies + the registry; unknown reads throw. */
function fakeFiles(): AuthorFiles {
  return {
    readAdr: async (relPath: string) => {
      const body = DOCS[relPath];
      if (body === undefined) throw new Error(`not found: ${relPath}`);
      return { body, title: relPath };
    },
    readModelRegistry: async () => registry,
  };
}

interface Captured {
  resolved: ResolvedModel;
  userPrompt: string;
  systemPrompt: string;
}

/** A model call that records what it received and returns a fixed proposal. */
function spyCall(proposal = 'REPLACEMENT'): { call: AuthorModelCall; box: { last: Captured | null } } {
  const box: { last: Captured | null } = { last: null };
  const call: AuthorModelCall = async (resolved, parts) => {
    box.last = { resolved, userPrompt: parts.userPrompt, systemPrompt: parts.systemPrompt };
    return proposal;
  };
  return { call, box };
}

function make(call: AuthorModelCall) {
  return createAuthorService({ files: fakeFiles(), env, call });
}

describe('authorService', () => {
  it('selection: returns a proposal and the prompt includes the selected text', async () => {
    const spy = spyCall('tightened text');
    const req: AuthorRequest = {
      scope: 'selection',
      instruction: 'tighten this',
      docPaths: ['databank/adr-007.md'],
      selectionText: 'Rotate tokens every 24h.',
    };
    const res = await make(spy.call).author(req);
    expect(res.proposal).toBe('tightened text');
    expect(spy.box.last?.userPrompt).toContain('Rotate tokens every 24h.');
    expect(spy.box.last?.userPrompt).toContain('tighten this');
  });

  it('selection: requires selectionText (fail fast)', async () => {
    await expect(
      make(spyCall().call).author({
        scope: 'selection',
        instruction: 'x',
        docPaths: ['databank/adr-007.md'],
      }),
    ).rejects.toThrow(/selectionText/);
  });

  it('selection: still works when the context doc cannot be read', async () => {
    const spy = spyCall('repl');
    const res = await make(spy.call).author({
      scope: 'selection',
      instruction: 'fix',
      docPaths: ['databank/missing.md'],
      selectionText: 'some text',
    });
    expect(res.proposal).toBe('repl');
    expect(spy.box.last?.userPrompt).toContain('some text');
  });

  it('doc: returns a proposal and the prompt includes the document body', async () => {
    const spy = spyCall('# Edited doc');
    const res = await make(spy.call).author({
      scope: 'doc',
      instruction: 'add an acceptance criterion for reuse detection',
      docPaths: ['databank/adr-007.md'],
    });
    expect(res.proposal).toBe('# Edited doc');
    expect(spy.box.last?.userPrompt).toContain('Rotate tokens every 24h.');
    expect(spy.box.last?.userPrompt).toContain('reuse detection');
  });

  it('multi: the prompt includes every referenced docPath content', async () => {
    const spy = spyCall('# Merged');
    const res = await make(spy.call).author({
      scope: 'multi',
      instruction: 'reconcile token and rate-limit policies',
      docPaths: ['databank/adr-007.md', 'databank/adr-012.md'],
    });
    expect(res.proposal).toBe('# Merged');
    expect(spy.box.last?.userPrompt).toContain('Rotate tokens every 24h.');
    expect(spy.box.last?.userPrompt).toContain('Limit to 100 req/min per key.');
    expect(spy.box.last?.userPrompt).toContain('databank/adr-007.md');
    expect(spy.box.last?.userPrompt).toContain('databank/adr-012.md');
  });

  it('multi: requires at least one docPath', async () => {
    await expect(
      make(spyCall().call).author({ scope: 'multi', instruction: 'x', docPaths: [] }),
    ).rejects.toThrow(/at least one docPath/);
  });

  it('empty instruction is rejected', async () => {
    await expect(
      make(spyCall().call).author({
        scope: 'doc',
        instruction: '   ',
        docPaths: ['databank/adr-007.md'],
      }),
    ).rejects.toThrow(/instruction is required/);
  });

  it('empty model output is rejected (no silent empty proposal)', async () => {
    await expect(
      make(spyCall('   ').call).author({
        scope: 'doc',
        instruction: 'edit',
        docPaths: ['databank/adr-007.md'],
      }),
    ).rejects.toThrow(/empty proposal/);
  });

  it('honors an explicit request model alias', async () => {
    const spy = spyCall();
    await make(spy.call).author({
      scope: 'doc',
      instruction: 'edit',
      docPaths: ['databank/adr-007.md'],
      model: 'nemotron',
    });
    expect(spy.box.last?.resolved.id).toBe('nvidia/llama-3.1-nemotron-70b-instruct');
    expect(spy.box.last?.resolved.provider).toBe('nebius');
  });

  it('falls back to the default alias when none is requested', async () => {
    const spy = spyCall();
    await make(spy.call).author({
      scope: 'doc',
      instruction: 'edit',
      docPaths: ['databank/adr-007.md'],
    });
    expect(spy.box.last?.resolved.id).toBe('claude-sonnet-4-6');
  });
});

describe('buildAuthorPrompt', () => {
  it('selection: throws without selectionText', () => {
    expect(() =>
      buildAuthorPrompt({ scope: 'selection', instruction: 'x', docPaths: [] }, []),
    ).toThrow(/selectionText/);
  });

  it('doc: tolerates an empty docs array', () => {
    const parts = buildAuthorPrompt(
      { scope: 'doc', instruction: 'summarize', docPaths: ['databank/adr-007.md'] },
      [],
    );
    expect(parts.userPrompt).toContain('summarize');
  });
});

describe('pickAuthorAlias', () => {
  const base: AuthorRequest = { scope: 'doc', instruction: 'x', docPaths: ['d'] };

  it('honors an explicit request alias over everything', () => {
    expect(pickAuthorAlias({ ...base, model: 'haiku' }, {}, registry)).toBe('haiku');
  });

  it('honors SLOOP_AUTHOR_MODEL when no request alias', () => {
    expect(pickAuthorAlias(base, { SLOOP_AUTHOR_MODEL: 'haiku' }, registry)).toBe('haiku');
  });

  it('falls back to the configured default when present', () => {
    expect(pickAuthorAlias(base, {}, registry, 'sonnet')).toBe('sonnet');
  });

  it('falls back to the first registry alias when the default is absent', () => {
    const small: ModelRegistry = {
      models: { haiku: registry.models.haiku },
      providers: registry.providers,
    };
    expect(pickAuthorAlias(base, {}, small, 'sonnet')).toBe('haiku');
  });

  it('throws on an empty registry', () => {
    const empty: ModelRegistry = { models: {}, providers: registry.providers };
    expect(() => pickAuthorAlias(base, {}, empty, 'sonnet')).toThrow(/registry is empty/);
  });
});
