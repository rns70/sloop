import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import type { LoopDoc, AdrDoc } from '../../shared';
import { createFilesService } from './filesService';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-files-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const loop = (): LoopDoc => ({
  relPath: 'cascades/test-cascade/nested/leaf-x.md',
  body: '# Leaf — x\n\nDo the thing.\n',
  frontmatter: {
    id: 'leaf-x',
    kind: 'leaf',
    role: 'engineer',
    model: 'haiku',
    status: 'planned',
    delta: 'change',
    parent: '_architect',
    children: [],
    sourceAdr: 'adr-007',
    template: 'spec-driven',
    executor: 'pi',
    acceptanceCriteria: [
      { id: 'ac-1', text: 'It works', verify: 'npm test -- x', passed: false },
    ],
  },
});

describe('FilesService', () => {
  it('writes a loop (criteria in body) then reads back an equal LoopDoc', async () => {
    const files = createFilesService(root);
    const original = loop();

    await files.writeLoop(original);
    const readBack = await files.readLoop(original.relPath);

    // Frontmatter (incl. acceptanceCriteria, re-parsed from the body) round-trips.
    expect(readBack.relPath).toBe(original.relPath);
    expect(readBack.frontmatter).toEqual(original.frontmatter);
    // The prose body is preserved and the criteria section is appended.
    expect(readBack.body).toContain('Do the thing.');
    expect(readBack.body).toContain('## Acceptance criteria');
    expect(readBack.body).toContain('**ac-1** It works — verify: `npm test -- x`');

    // Criteria are no longer in frontmatter on disk.
    const raw = await fs.readFile(path.join(root, original.relPath), 'utf8');
    expect(raw).not.toContain('acceptanceCriteria:');
  });

  it('lists loops in a cascade recursively, excluding _cascade.md', async () => {
    const files = createFilesService(root);
    await files.writeLoop(loop());
    await files.writeLoop({
      ...loop(),
      relPath: 'cascades/test-cascade/_architect.md',
      frontmatter: { ...loop().frontmatter, id: '_architect', kind: 'architect' },
    });
    // Cascade metadata file must be ignored by listLoops.
    await fs.mkdir(path.join(root, 'cascades/test-cascade'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'cascades/test-cascade/_cascade.md'),
      '---\nid: test-cascade\n---\n\nmeta\n',
      'utf8',
    );

    const loops = await files.listLoops('test-cascade');
    const ids = loops.map((l) => l.frontmatter.id).sort();
    expect(ids).toEqual(['_architect', 'leaf-x']);
  });

  it('writes an ADR (criteria in body) then reads it back', async () => {
    const files = createFilesService(root);
    const adr: AdrDoc = {
      id: 'adr-099',
      relPath: 'databank/adr-099-sample.md',
      title: 'Sample requirement',
      body: '# ADR-099\n\nContext.\n',
      acceptanceCriteria: [{ id: 'ac-1', text: 'Holds', passed: false }],
    };

    await files.writeAdr(adr);
    const readBack = await files.readAdr(adr.relPath);

    // Field round-trips; body now carries the criteria section.
    expect(readBack.acceptanceCriteria).toEqual(adr.acceptanceCriteria);
    expect(readBack.body).toContain('Context.');
    expect(readBack.body).toContain('## Acceptance criteria');
    expect(readBack.body).toContain('**ac-1** Holds');

    // Criteria are no longer in frontmatter on disk.
    const raw = await fs.readFile(path.join(root, adr.relPath), 'utf8');
    expect(raw).not.toContain('acceptanceCriteria:');

    const all = await files.listAdrs();
    expect(all.map((a) => a.id)).toEqual(['adr-099']);
  });

  it('reads templates, roles, and the model registry from a workspace copy', async () => {
    // Copy the bundled sample workspace's .sloop into the temp root.
    const sample = path.resolve('fixtures/sample-workspace/.sloop');
    await fs.cp(sample, path.join(root, '.sloop'), { recursive: true });
    const files = createFilesService(root);

    const templates = await files.listTemplates();
    expect(templates.find((t) => t.id === 'spec-driven')?.stages.length).toBeGreaterThan(0);

    const roles = await files.listRoles();
    expect(roles.find((r) => r.id === 'engineer')?.brief).toContain('Engineer');

    const registry = await files.readModelRegistry();
    expect(registry.models.opus.provider).toBe('anthropic');
    expect(registry.providers.nebius.baseUrl).toContain('nebius');
  });

  it('carries the locked flag on acceptance criteria through normalizeCriteria', async () => {
    await fs.mkdir(path.join(root, 'databank'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'databank/adr-100.md'),
      [
        '---',
        'id: adr-100',
        'title: Locked criterion',
        'acceptanceCriteria:',
        '  - { id: ac-1, text: "stays locked", verify: "npm test", locked: true }',
        '  - { id: ac-2, text: "unlocked default" }',
        '---',
        '',
        'body',
      ].join('\n'),
      'utf8',
    );
    const files = createFilesService(root);
    const adr = (await files.listAdrs()).find((a) => a.id === 'adr-100');
    expect(adr?.acceptanceCriteria[0].locked).toBe(true);
    expect(adr?.acceptanceCriteria[1].locked).toBeUndefined();
  });

  it('returns empty lists when optional directories are absent', async () => {
    const files = createFilesService(root);
    expect(await files.listAdrs()).toEqual([]);
    expect(await files.listTemplates()).toEqual([]);
    expect(await files.listRoles()).toEqual([]);
    expect(await files.listLoops('does-not-exist')).toEqual([]);
  });

  it('treats the body as authoritative over the acceptanceCriteria field on write', async () => {
    const files = createFilesService(root);
    const relPath = 'databank/adr-101.md';
    await files.writeAdr({
      id: 'adr-101',
      relPath,
      title: 'Body wins',
      body: '# A\n\n## Acceptance criteria\n\n- [x] **ac-1** From body\n',
      acceptanceCriteria: [{ id: 'ac-9', text: 'From field', passed: false }],
    });
    const readBack = await files.readAdr(relPath);
    expect(readBack.acceptanceCriteria).toEqual([{ id: 'ac-1', text: 'From body', passed: true }]);
  });

  it('migrates a legacy frontmatter ADR into the body on read and write', async () => {
    await fs.mkdir(path.join(root, 'databank'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'databank/adr-legacy.md'),
      [
        '---',
        'id: adr-legacy',
        'title: Legacy',
        'acceptanceCriteria:',
        '  - { id: ac-1, text: "old style", verify: "npm test", locked: true }',
        '---',
        '',
        'Context.',
      ].join('\n'),
      'utf8',
    );
    const files = createFilesService(root);

    // Read injects a canonical body section so the editor shows criteria immediately.
    const read = await files.readAdr('databank/adr-legacy.md');
    expect(read.body).toContain('## Acceptance criteria');
    expect(read.body).toContain('**ac-1** old style');
    expect(read.acceptanceCriteria[0].locked).toBe(true);

    // Writing it back migrates the disk file: criteria leave frontmatter, enter the body.
    await files.writeAdr(read);
    const raw = await fs.readFile(path.join(root, 'databank/adr-legacy.md'), 'utf8');
    expect(raw).not.toContain('acceptanceCriteria:');
    expect(raw).toContain('## Acceptance criteria');
    expect(raw).toContain('🔒');
  });
});
