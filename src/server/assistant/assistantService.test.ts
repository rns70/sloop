import { describe, it, expect } from 'vitest';
import type { ModelRegistry } from '../../shared/index';
import type { AssistantFiles, AssistantModelCall } from './assistantService';
import { createAssistantService } from './assistantService';

const registry: ModelRegistry = {
  models: { sonnet: { provider: 'anthropic', id: 'claude-sonnet-4-6' } },
  providers: {
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
    nebius: { baseUrl: 'https://api.studio.nebius.ai/v1', apiKeyEnv: 'NEBIUS_API_KEY' },
  },
};
const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'k' };
const DOCS: Record<string, string> = { 'databank/adr-007.md': '# Token rotation' };
function fakeFiles(): AssistantFiles {
  return {
    readAdr: async (relPath: string) => {
      const body = DOCS[relPath];
      if (body === undefined) throw new Error(`not found: ${relPath}`);
      return { body };
    },
    readModelRegistry: async () => registry,
  };
}
const make = (call: AssistantModelCall) => createAssistantService({ files: fakeFiles(), env, call });

describe('assistantService', () => {
  it('returns a typed create-role proposal from an envelope', async () => {
    const svc = make(async () =>
      '<action>create-role</action>\n<path>.sloop/roles/sec.md</path>\n<content>---\nid: sec\n---\nbrief</content>');
    const p = await svc.assistant({ instruction: 'make a role', contextPaths: [] });
    expect(p.action).toBe('create-role');
    expect(p.targetPath).toBe('.sloop/roles/sec.md');
    expect(p.content).toContain('id: sec');
  });
  it('passes loaded context docs into the model call', async () => {
    let seenUser = '';
    const svc = make(async (_r, parts) => { seenUser = parts.userPrompt; return '<action>answer</action>\n<content>ok</content>'; });
    await svc.assistant({ instruction: 'summarize', contextPaths: ['databank/adr-007.md'] });
    expect(seenUser).toContain('# Token rotation');
  });
  it('degrades to answer when a context doc cannot be read', async () => {
    const svc = make(async () => '<action>answer</action>\n<content>fine</content>');
    const p = await svc.assistant({ instruction: 'x', contextPaths: ['databank/missing.md'] });
    expect(p.action).toBe('answer');
    expect(p.content).toBe('fine');
  });
  it('throws on an empty instruction', async () => {
    const svc = make(async () => '<action>answer</action>\n<content>x</content>');
    await expect(svc.assistant({ instruction: '  ', contextPaths: [] })).rejects.toThrow(/instruction/);
  });
  it('throws when the model returns empty content', async () => {
    const svc = make(async () => '<action>answer</action>\n<content></content>');
    await expect(svc.assistant({ instruction: 'x', contextPaths: [] })).rejects.toThrow(/empty/);
  });
});
