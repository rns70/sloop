import { describe, it, expect } from 'vitest';
import type { AdrDoc, RoleDef, WorkflowDef, ModelRegistry } from '../../shared/index';
import { ASSISTANT_TOOLS, createToolExecutor, type AssistantWorkspace } from './tools';

function fakeWorkspace(over: Partial<AssistantWorkspace> = {}): { ws: AssistantWorkspace; writes: Array<{ path: string; body: string }> } {
  const writes: Array<{ path: string; body: string }> = [];
  const adrs: AdrDoc[] = [{ id: 'auth', relPath: 'loops/auth.md', title: 'Auth', body: 'Auth rules', acceptanceCriteria: [], children: [], status: 'idle', outputs: [] }];
  const roles: RoleDef[] = [{ id: 'architect', name: 'Architect', defaultModel: 'opus', brief: '' }];
  const workflows: WorkflowDef[] = [];
  const ws: AssistantWorkspace = {
    listAdrs: async () => adrs,
    readAdr: async (p) => { const a = adrs.find((x) => x.relPath === p); if (!a) throw new Error('not found'); return a; },
    writeAdr: async (d) => { writes.push({ path: d.relPath, body: d.body }); },
    listRoles: async () => roles,
    listWorkflows: async () => workflows,
    writeRaw: async (p, c) => { writes.push({ path: p, body: c }); },
    readModelRegistry: async () => ({ models: {} } as ModelRegistry),
    ...over,
  };
  return { ws, writes };
}

describe('ASSISTANT_TOOLS', () => {
  it('exposes the read and write tools by name', () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['create_adr', 'create_role', 'create_workflow', 'edit_doc', 'list_docs', 'read_doc', 'search'].sort());
  });
});

describe('createToolExecutor', () => {
  it('create_adr uniquifies the slug against existing ADRs', async () => {
    const { ws, writes } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '1', name: 'create_adr', arguments: { title: 'Auth', content: 'New body' } });
    expect(r.ok).toBe(true);
    expect(r.path).toBe('loops/auth-2.md'); // 'auth' taken
    expect(writes).toContainEqual({ path: 'loops/auth-2.md', body: 'New body' });
  });

  it('create_adr warns when the body has no acceptance criteria', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: 'c1', name: 'create_adr', arguments: { title: 'Login', content: '## Decision\n\nUse OAuth.' } });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('no acceptance criteria');
  });

  it('create_adr does not warn when the body includes a criteria checklist', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const body = '## Decision\n\nUse OAuth.\n\n## Acceptance criteria\n\n- [ ] Login redirects to the IdP — verify: `curl -sI / | grep 302`';
    const r = await exec.run({ type: 'toolCall', id: 'c2', name: 'create_adr', arguments: { title: 'Login', content: body } });
    expect(r.ok).toBe(true);
    expect(r.text).not.toContain('no acceptance criteria');
  });

  it('edit_doc warns when an ADR is rewritten without criteria, but not raw files', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const adr = await exec.run({ type: 'toolCall', id: 'e1', name: 'edit_doc', arguments: { path: 'loops/auth.md', content: 'No criteria here' } });
    expect(adr.text).toContain('no acceptance criteria');
    const raw = await exec.run({ type: 'toolCall', id: 'e2', name: 'edit_doc', arguments: { path: '.sloop/roles/x.md', content: 'whatever' } });
    expect(raw.text).not.toContain('no acceptance criteria');
  });

  it('edit_doc on an ADR replaces the body', async () => {
    const { ws, writes } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '2', name: 'edit_doc', arguments: { path: 'loops/auth.md', content: 'Rewritten' } });
    expect(r.ok).toBe(true);
    expect(writes).toContainEqual({ path: 'loops/auth.md', body: 'Rewritten' });
  });

  it('edit_doc on an unknown path returns an error result (never throws)', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '3', name: 'edit_doc', arguments: { path: 'loops/nope.md', content: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.text.toLowerCase()).toContain('not found');
  });

  it('create_role writes the full file verbatim to .sloop/roles', async () => {
    const { ws, writes } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const full = '---\nid: sec\nname: Sec\ndefaultModel: opus\n---\n\nbrief';
    const r = await exec.run({ type: 'toolCall', id: '4', name: 'create_role', arguments: { content: full, slug: 'sec' } });
    expect(r.path).toBe('.sloop/roles/sec.md');
    expect(writes).toContainEqual({ path: '.sloop/roles/sec.md', body: full });
  });

  it('search returns matching ADR paths', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '5', name: 'search', arguments: { query: 'rules' } });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('loops/auth.md');
  });

  it('unknown tool returns an error result', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '6', name: 'frobnicate', arguments: {} });
    expect(r.ok).toBe(false);
  });

  it('create_workflow writes the full file verbatim to .sloop/workflows', async () => {
    const { ws, writes } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const full = '---\nid: rev\nname: Review\nsteps: []\n---\n\nguidance';
    const r = await exec.run({ type: 'toolCall', id: '7', name: 'create_workflow', arguments: { content: full, slug: 'rev' } });
    expect(r.path).toBe('.sloop/workflows/rev.md');
    expect(writes).toContainEqual({ path: '.sloop/workflows/rev.md', body: full });
  });

  it('read_doc truncates long bodies with …[truncated]', async () => {
    const longBody = 'x'.repeat(7000);
    const { ws } = fakeWorkspace({
      listAdrs: async () => [{ id: 'big', relPath: 'loops/big.md', title: 'Big', body: longBody, acceptanceCriteria: [], children: [], status: 'idle', outputs: [] }],
      readAdr: async () => ({ id: 'big', relPath: 'loops/big.md', title: 'Big', body: longBody, acceptanceCriteria: [], children: [], status: 'idle', outputs: [] }),
    });
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '8', name: 'read_doc', arguments: { path: 'loops/big.md' } });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('…[truncated]');
    expect(r.text.length).toBeLessThan(longBody.length);
  });

  it('search finds a matching role', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '9', name: 'search', arguments: { query: 'architect' } });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('architect');
  });
});
