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
  it('writes a loop then reads back an equal LoopDoc, creating dirs as needed', async () => {
    const files = createFilesService(root);
    const original = loop();

    await files.writeLoop(original);
    const readBack = await files.readLoop(original.relPath);

    expect(readBack.relPath).toBe(original.relPath);
    expect(readBack.frontmatter).toEqual(original.frontmatter);
    expect(readBack.body).toBe(original.body);
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

  it('writes an ADR then reads it back with its acceptance criteria', async () => {
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
    expect(readBack).toEqual(adr);

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
});
