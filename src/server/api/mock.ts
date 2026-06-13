// In-memory mock backend. Reads the sample workspace on boot and serves every
// endpoint from real fixture data, so the frontend (WP-4/WP-5) can be built end to
// end before any real service exists. Cascade kickoff/approve mutate in-memory
// state; streamEvents() returns a scripted loop progression for the live view.
//
// This file is deliberately self-contained (its own lightweight markdown loading)
// so it does not depend on WP-1's FilesService. WP-6 replaces it with real handlers.

import matter from 'gray-matter';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AdrDoc, WorkflowDef, RoleDef, LoopDoc, LoopFrontmatter, CascadeSummary,
  ModelRegistry, AcceptanceCriterion,
} from '../../shared/index';
import type { AssistantRequest } from '../../shared/index';
import type {
  SloopApi, AdrDiffResponse, CascadeDetail, CreateCascadeRequest, CascadeStreamEvent,
  AssistantResponse, GetModelsResponse, Ok,
} from './contract';
import { toModelOptions } from '../assistant/index';

const OK: Ok = { ok: true };

function readMd(abs: string): { data: Record<string, unknown>; content: string } {
  const parsed = matter(readFileSync(abs, 'utf8'));
  return { data: parsed.data as Record<string, unknown>, content: parsed.content.trim() };
}

function loadAdrs(root: string): AdrDoc[] {
  const dir = join(root, 'databank');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { data, content } = readMd(join(dir, f));
      return {
        id: String(data.id),
        relPath: `databank/${f}`,
        title: String(data.title ?? f),
        body: content,
        acceptanceCriteria: (data.acceptanceCriteria as AcceptanceCriterion[]) ?? [],
      };
    });
}

function loadRoles(root: string): RoleDef[] {
  const dir = join(root, '.sloop', 'roles');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { data, content } = readMd(join(dir, f));
      return {
        id: String(data.id),
        name: String(data.name),
        defaultModel: String(data.defaultModel),
        brief: content,
        color: data.color ? String(data.color) : undefined,
      };
    });
}

function loadWorkflows(root: string): WorkflowDef[] {
  const dir = join(root, '.sloop', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { data, content } = readMd(join(dir, f));
      return {
        id: String(data.id),
        name: String(data.name),
        steps: (data.steps as WorkflowDef['steps']) ?? [],
        guidance: content,
      };
    });
}

function loadRegistry(root: string): ModelRegistry {
  const abs = join(root, '.sloop', 'config.md');
  const { data } = readMd(abs);
  return {
    models: (data.models as ModelRegistry['models']) ?? {},
    providers: (data.providers as ModelRegistry['providers']) ?? {
      anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      nebius: { baseUrl: 'https://api.studio.nebius.ai/v1', apiKeyEnv: 'NEBIUS_API_KEY' },
    },
  };
}

function loadCascade(root: string, id: string): CascadeDetail | undefined {
  const dir = join(root, 'cascades', id);
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  const cascadeFile = files.find((f) => f === '_cascade.md');
  if (!cascadeFile) return undefined;
  const { data: cdata } = readMd(join(dir, cascadeFile));
  const summary: CascadeSummary = {
    id: String(cdata.id),
    createdAt: String(cdata.createdAt),
    workflow: String(cdata.workflow),
    deltas: (cdata.deltas as CascadeSummary['deltas']) ?? { add: 0, change: 0, delete: 0 },
    rootLoopId: String(cdata.rootLoopId),
    status: (cdata.status as CascadeSummary['status']) ?? 'awaiting_approval',
  };

  const loops: LoopDoc[] = files
    .filter((f) => f !== '_cascade.md')
    .sort()
    .map((f) => {
      const { data, content } = readMd(join(dir, f));
      return {
        frontmatter: data as unknown as LoopFrontmatter,
        body: content,
        relPath: `cascades/${id}/${f}`,
      };
    });

  return { summary, loops };
}

/** Deep clone via structured serialization — loops are plain JSON-safe data. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MockApi implements SloopApi {
  private adrs: AdrDoc[];
  private roles: RoleDef[];
  private workflows: WorkflowDef[];
  readonly registry: ModelRegistry;
  /** The pristine sample cascade, used as the workflow for new kickoffs. */
  private readonly sample: CascadeDetail;
  private cascades = new Map<string, CascadeDetail>();
  private kickoffCount = 0;

  constructor(root: string) {
    this.adrs = loadAdrs(root);
    this.roles = loadRoles(root);
    this.workflows = loadWorkflows(root);
    this.registry = loadRegistry(root);

    const sampleId = '2026-06-13-token-rotation-sync';
    const sample = loadCascade(root, sampleId);
    if (!sample) {
      throw new Error(`Mock seed missing: sample cascade "${sampleId}" not found under ${root}.`);
    }
    this.sample = sample;
    // Pre-register the seeded cascade so Mission Control has something to render immediately.
    this.cascades.set(sampleId, clone(sample));
  }

  async listAdrs(): Promise<AdrDoc[]> {
    return clone(this.adrs);
  }

  async getAdr(relPath: string): Promise<AdrDoc> {
    const adr = this.adrs.find((a) => a.relPath === relPath);
    if (!adr) throw new NotFound(`ADR not found: ${relPath}`);
    return clone(adr);
  }

  async putAdr(relPath: string, doc: AdrDoc): Promise<Ok> {
    const idx = this.adrs.findIndex((a) => a.relPath === relPath);
    const next = clone(doc);
    if (idx === -1) this.adrs.push(next);
    else this.adrs[idx] = next;
    return OK;
  }

  async getAdrDiff(relPath: string): Promise<AdrDiffResponse> {
    // Mock: no real git history yet (WP-1 owns GitService). Echo current content as
    // both sides so the diff view renders without a backend.
    const adr = this.adrs.find((a) => a.relPath === relPath);
    if (!adr) throw new NotFound(`ADR not found: ${relPath}`);
    return { before: adr.body, after: adr.body };
  }

  async listWorkflows(): Promise<WorkflowDef[]> {
    return clone(this.workflows);
  }

  async listRoles(): Promise<RoleDef[]> {
    return clone(this.roles);
  }

  async listModels(): Promise<GetModelsResponse> {
    return toModelOptions(this.registry);
  }

  /**
   * Deterministic stand-in for the real pi-ai assistant (WP-6 swaps in createAssistantService).
   * Keyword-routes the instruction to a plausible typed proposal so the rail's preview +
   * confirm + write flow can be exercised end to end against the mock — never writes itself.
   */
  async assistant(req: AssistantRequest): Promise<AssistantResponse> {
    const text = req.instruction.trim();
    const lower = text.toLowerCase();
    if (lower.includes('role')) {
      const slug = 'security-reviewer';
      return { action: 'create-role', summary: `Create role at .sloop/roles/${slug}.md`,
        targetPath: `.sloop/roles/${slug}.md`,
        content: `---\nid: ${slug}\nname: Security Reviewer\ndefaultModel: opus\n---\n\n${text}\n` };
    }
    if (lower.includes('workflow')) {
      const slug = 'review-pipeline';
      return { action: 'create-workflow', summary: `Create workflow at .sloop/workflows/${slug}.md`,
        targetPath: `.sloop/workflows/${slug}.md`,
        content: `---\nid: ${slug}\nname: Review Pipeline\nsteps:\n  - name: architect\n    role: architect\n    model: opus\n---\n\n${text}\n` };
    }
    if (lower.includes('adr') || lower.includes('requirement') || lower.includes('document')) {
      return { action: 'create-adr', summary: 'Create a new databank ADR',
        targetPath: 'databank/untitled.md', title: 'Untitled requirement', content: `\n${text}\n` };
    }
    const primary = this.adrs.find((a) => a.relPath === req.contextPaths[0]);
    if (primary) {
      return { action: 'edit', summary: `Edit ${primary.relPath}`, targetPath: primary.relPath,
        content: `${primary.body}\n\n_Assistant: ${text}_` };
    }
    return { action: 'answer', summary: 'Answer', content: `(mock answer) ${text}` };
  }

  async listCascades(): Promise<CascadeSummary[]> {
    // Newest first: ids are date-prefixed, so a descending id sort is chronological.
    return [...this.cascades.values()]
      .map((c) => clone(c.summary))
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  async createCascade(req: CreateCascadeRequest): Promise<CascadeSummary> {
    // Fake the architect: clone the sample tree under a fresh id, awaiting approval.
    this.kickoffCount += 1;
    const id = `${new Date().toISOString().slice(0, 10)}-cascade-${this.kickoffCount}`;
    const detail = clone(this.sample);
    detail.summary = {
      ...detail.summary,
      id,
      workflow: req.workflowId,
      createdAt: new Date().toISOString(),
      status: 'awaiting_approval',
    };
    detail.loops = detail.loops.map((loop) => ({
      ...loop,
      relPath: loop.relPath.replace(this.sample.summary.id, id),
      frontmatter: {
        ...loop.frontmatter,
        workflow: req.workflowId,
        status: loop.frontmatter.kind === 'architect' ? 'awaiting_approval' : 'planned',
      },
    }));
    this.cascades.set(id, detail);
    return clone(detail.summary);
  }

  async getCascade(id: string): Promise<CascadeDetail> {
    const detail = this.cascades.get(id);
    if (!detail) throw new NotFound(`Cascade not found: ${id}`);
    return clone(detail);
  }

  async approveCascade(id: string): Promise<Ok> {
    const detail = this.cascades.get(id);
    if (!detail) throw new NotFound(`Cascade not found: ${id}`);
    // Approval flips the tree out of the checkpoint into execution. The detailed
    // progression is narrated over WS via streamEvents().
    detail.summary.status = 'executing';
    for (const loop of detail.loops) {
      if (loop.frontmatter.kind !== 'architect') loop.frontmatter.status = 'queued';
    }
    return OK;
  }

  async streamEvents(id: string): Promise<CascadeStreamEvent[]> {
    const detail = this.cascades.get(id);
    if (!detail) throw new NotFound(`Cascade not found: ${id}`);

    const events: CascadeStreamEvent[] = [];
    const leaves = detail.loops.filter((l) => l.frontmatter.kind === 'leaf');
    const architect = detail.loops.find((l) => l.frontmatter.kind === 'architect');

    const emit = (loop: LoopDoc, status: LoopDoc['frontmatter']['status'], pass = false) => {
      loop.frontmatter.status = status;
      if (pass) loop.frontmatter.acceptanceCriteria.forEach((c) => (c.passed = true));
      events.push({ type: 'loop-update', loop: clone(loop) });
    };

    for (const leaf of leaves) {
      emit(leaf, 'executing');
      events.push({
        type: 'output',
        loopId: leaf.frontmatter.id,
        chunk: `[${leaf.frontmatter.model}] running ${leaf.frontmatter.id}…\n`,
      });
      for (const c of leaf.frontmatter.acceptanceCriteria) {
        events.push({
          type: 'output',
          loopId: leaf.frontmatter.id,
          chunk: `$ ${c.verify ?? '(no verify command)'}\n→ exit 0 ✓\n`,
        });
      }
      emit(leaf, 'review');
      emit(leaf, 'done', true);
    }

    if (architect) emit(architect, 'done');
    detail.summary.status = 'done';

    return events;
  }
}

export class NotFound extends Error {}
