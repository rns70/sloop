import { describe, it, expect } from 'vitest';
import type { AssistantProposal } from '../api-client/index';
import { planWrite } from './planWrite';

const existing = { adrPaths: ['databank/auth.md'], roleIds: ['architect'], templateIds: ['default'] };

describe('planWrite', () => {
  it('plans an answer with no write', () => {
    const p: AssistantProposal = { action: 'answer', summary: 's', content: 'hello' };
    expect(planWrite(p, existing)).toEqual({ kind: 'answer', text: 'hello' });
  });
  it('plans an edit to the target path', () => {
    const p: AssistantProposal = { action: 'edit', summary: 's', targetPath: 'databank/auth.md', content: 'new body' };
    expect(planWrite(p, existing)).toEqual({ kind: 'edit', relPath: 'databank/auth.md', content: 'new body' });
  });
  it('plans a create-adr, building an AdrDoc and uniquifying a colliding slug', () => {
    const p: AssistantProposal = { action: 'create-adr', summary: 's', targetPath: 'databank/auth.md', title: 'Auth', content: 'body' };
    const plan = planWrite(p, existing);
    if (plan.kind !== 'create-adr') throw new Error('wrong kind');
    expect(plan.relPath).toBe('databank/auth-2.md');
    expect(plan.doc).toEqual({ id: 'auth-2', relPath: 'databank/auth-2.md', title: 'Auth', body: 'body', acceptanceCriteria: [] });
  });
  it('plans a create-role as a raw file with a unique id', () => {
    const p: AssistantProposal = { action: 'create-role', summary: 's', targetPath: '.sloop/roles/architect.md', content: '---\nid: architect\n---\nbrief' };
    expect(planWrite(p, existing)).toEqual({ kind: 'create-file', relPath: '.sloop/roles/architect-2.md', content: '---\nid: architect\n---\nbrief', libKind: 'roles' });
  });
  it('plans a create-template under .sloop/templates', () => {
    const p: AssistantProposal = { action: 'create-template', summary: 's', targetPath: '.sloop/templates/ci.md', content: 'tpl' };
    const plan = planWrite(p, existing);
    if (plan.kind !== 'create-file') throw new Error('wrong kind');
    expect(plan.relPath).toBe('.sloop/templates/ci.md');
    expect(plan.libKind).toBe('templates');
  });
  it('derives an ADR slug from the title when targetPath is missing', () => {
    const p: AssistantProposal = { action: 'create-adr', summary: 's', title: 'Rate Limiting!', content: 'b' };
    const plan = planWrite(p, existing);
    if (plan.kind !== 'create-adr') throw new Error('wrong kind');
    expect(plan.relPath).toBe('databank/rate-limiting.md');
  });
});
