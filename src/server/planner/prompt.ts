import type { DatabankDiff, Delta, RoleDef, WorkflowDef } from '../../shared/index';

/**
 * Pure prompt construction + response parsing for the architecture loop.
 *
 * The architect reads the databank diff and a process workflow, then proposes a
 * SMALL tree of role-typed leaf loops — each carrying acceptance criteria with a
 * stable id and (where possible) a `verify` command, because the convergence
 * invariant (§3) is only *real* when a criterion's truth is a shell exit code.
 *
 * Both functions here are pure (no I/O, no clock, no model SDK) so they can be
 * unit-tested directly; the actual model call lives in `architect.ts`.
 */

/** A single proposed acceptance criterion (before the engine stamps `passed`). */
export interface ProposedCriterion {
  id: string;
  text: string;
  verify?: string;
  locked?: boolean;
}

/** A leaf loop the architect proposes; the engine turns these into `LoopDoc`s. */
export interface ProposedLeaf {
  id: string;
  role: string;
  model: string;
  delta?: Delta;
  sourceAdr?: string;
  brief: string;
  acceptanceCriteria: ProposedCriterion[];
}

/** The architect's structured plan, parsed from the model response. */
export interface ArchitectPlan {
  /** Registry alias the architect planning ran on (recorded on the root loop). */
  plannerAlias: string;
  /** Human-readable summary for the `_architect.md` body. */
  summary: string;
  leaves: ProposedLeaf[];
}

export interface ArchitectPromptParts {
  systemPrompt: string;
  userPrompt: string;
}

const VALID_DELTAS: readonly Delta[] = ['add', 'change', 'delete'];

/** Truncate ADR before/after text so a large diff cannot blow the context window. */
function clip(text: string, max = 1200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/**
 * Build the system + user prompt for the architect. `maxLeaves` is passed through
 * so the model is told the same cap the engine will later enforce — keeping the
 * tree shallow (architect → leaves) is a hard requirement for safe live demos.
 */
export function buildArchitectPrompt(
  diff: DatabankDiff,
  workflow: WorkflowDef,
  roles: RoleDef[],
  maxLeaves: number,
): ArchitectPromptParts {
  const roleLines = roles
    .map((r) => `- ${r.id} (${r.name}, default model: ${r.defaultModel}): ${r.brief.replace(/\s+/g, ' ').trim()}`)
    .join('\n');

  const stepLines = workflow.steps
    .map((s) => `- ${s.name}: role=${s.role}, model=${s.model}${s.gate ? ' [GATE]' : ''}`)
    .join('\n');

  const diffBlocks = diff.changed
    .map(
      (c, i) =>
        `### Delta ${i + 1}: ${c.delta} — ${c.relPath}\n` +
        `--- before ---\n${clip(c.before)}\n--- after ---\n${clip(c.after)}`,
    )
    .join('\n\n');

  const systemPrompt = [
    'You are the **Architect** loop in sloop, an IDE for agent factories.',
    'sloop keeps a codebase continuously reconciled to a databank of requirement ADRs.',
    '',
    'Your job: read the databank diff and decompose it into a SMALL tree of role-typed',
    'leaf loops that follow the chosen process workflow. Each leaf is a unit of work',
    'small enough to verify directly.',
    '',
    'The convergence invariant governs completion: a loop is DONE iff all its children',
    'are done AND its acceptance criteria pass. A criterion passes when its `verify`',
    'shell command exits 0. Therefore EVERY criterion you write should carry a concrete',
    '`verify` command wherever one is plausible (e.g. a test or lint invocation); a',
    'criterion with no machine check cannot be proven done.',
    '',
    'Rules:',
    `- Propose at most ${maxLeaves} leaves. Keep the tree shallow: architect → leaves.`,
    '- Give every leaf a stable kebab-case id, unique within this cascade.',
    '- Partition leaves by file: no two leaves may edit the same file (they share one',
    '  checkout and would collide).',
    "- Choose each leaf's role from the roles list and a model alias from the workflow",
    '  step defaults or the role default. The step model is a floor for bounded work;',
    "  raise a leaf's model for open-ended or long-horizon tasks.",
    '- Copy each acceptance criterion onto the leaf that satisfies it (stable id + text +',
    '  verify). Set "locked": true on every criterion you author — a locked criterion may',
    '  not be weakened by the leaf that executes it.',
    '- Stages marked [GATE] are hard verification checkpoints; their criteria must be',
    '  locked and backed by a concrete verify command.',
    '',
    'Respond with STRICT JSON only (no prose, no markdown fences) of this shape:',
    '{',
    '  "summary": "one short paragraph describing the proposed tree",',
    '  "leaves": [',
    '    {',
    '      "id": "kebab-case-id",',
    '      "role": "engineer",',
    '      "model": "haiku",',
    '      "delta": "change",',
    '      "sourceAdr": "adr-007",',
    '      "brief": "what this leaf must do",',
    '      "acceptanceCriteria": [',
    '        { "id": "ac-1", "text": "…", "verify": "npm test -- rotation", "locked": true }',
    '      ]',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const userPrompt = [
    `# Process workflow: ${workflow.name} (${workflow.id})`,
    'Stages:',
    stepLines || '- (none)',
    '',
    'Guidance:',
    workflow.guidance.trim() || '(none)',
    '',
    '# Available roles',
    roleLines || '- (none)',
    '',
    `# Databank diff — ${diff.changed.length} delta(s)`,
    diffBlocks || '(no changes)',
    '',
    'Propose the tree now as strict JSON.',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

/** Extract the first balanced top-level JSON object from a model response. */
function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : raw).trim();

  const start = text.indexOf('{');
  if (start === -1) throw new Error('Architect response contained no JSON object.');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('Architect response had an unbalanced JSON object.');
}

export interface ParseOptions {
  plannerAlias: string;
  workflow: WorkflowDef;
  roles: RoleDef[];
  maxLeaves: number;
}

function resolveLeafModel(
  rawModel: unknown,
  role: string,
  workflow: WorkflowDef,
  roles: RoleDef[],
): string {
  if (typeof rawModel === 'string' && rawModel.trim()) return rawModel.trim();
  const step = workflow.steps.find((s) => s.role === role);
  if (step?.model) return step.model;
  const roleDef = roles.find((r) => r.id === role);
  if (roleDef?.defaultModel) return roleDef.defaultModel;
  // Fall back to the implement step, then the first step — a leaf must have a model.
  return (
    workflow.steps.find((s) => s.name === 'implement')?.model ??
    workflow.steps[0]?.model ??
    'haiku'
  );
}

/**
 * Parse + validate the architect's JSON response into an `ArchitectPlan`. Fails
 * fast on malformed output (a misbehaving planner must surface loudly, not yield a
 * silently empty tree). Defaults each leaf's model from the workflow/role when the
 * planner omits it, and clamps the leaf count to `maxLeaves` (logging the drop).
 */
export function parseArchitectResponse(raw: string, opts: ParseOptions): ArchitectPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch (err) {
    throw new Error(`Failed to parse architect response as JSON: ${(err as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Architect response was not a JSON object.');
  }
  const obj = parsed as Record<string, unknown>;

  const rawLeaves = obj.leaves;
  if (!Array.isArray(rawLeaves) || rawLeaves.length === 0) {
    throw new Error('Architect response must contain a non-empty "leaves" array.');
  }

  const seenIds = new Set<string>();
  const leaves: ProposedLeaf[] = rawLeaves.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Leaf ${i} is not an object.`);
    }
    const l = entry as Record<string, unknown>;

    const id = typeof l.id === 'string' ? l.id.trim() : '';
    if (!id) throw new Error(`Leaf ${i} is missing a string "id".`);
    if (seenIds.has(id)) throw new Error(`Duplicate leaf id "${id}".`);
    seenIds.add(id);

    const role = typeof l.role === 'string' && l.role.trim() ? l.role.trim() : 'engineer';
    const brief = typeof l.brief === 'string' ? l.brief.trim() : '';

    const delta =
      typeof l.delta === 'string' && (VALID_DELTAS as readonly string[]).includes(l.delta)
        ? (l.delta as Delta)
        : undefined;

    const rawCriteria = Array.isArray(l.acceptanceCriteria) ? l.acceptanceCriteria : [];
    const acceptanceCriteria: ProposedCriterion[] = rawCriteria.map((c, ci) => {
      const cc = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
      return {
        id: typeof cc.id === 'string' && cc.id.trim() ? cc.id.trim() : `ac-${ci + 1}`,
        text: typeof cc.text === 'string' ? cc.text.trim() : '',
        verify:
          typeof cc.verify === 'string' && cc.verify.trim() ? cc.verify.trim() : undefined,
        locked: typeof cc.locked === 'boolean' ? cc.locked : undefined,
      };
    });

    return {
      id,
      role,
      model: resolveLeafModel(l.model, role, opts.workflow, opts.roles),
      delta,
      sourceAdr:
        typeof l.sourceAdr === 'string' && l.sourceAdr.trim() ? l.sourceAdr.trim() : undefined,
      brief,
      acceptanceCriteria,
    };
  });

  let kept = leaves;
  if (leaves.length > opts.maxLeaves) {
    // Never silently truncate — make the dropped work visible.
    console.warn(
      `[architect] planner proposed ${leaves.length} leaves; clamping to maxLeaves=${opts.maxLeaves}. ` +
        `Dropped: ${leaves.slice(opts.maxLeaves).map((l) => l.id).join(', ')}.`,
    );
    kept = leaves.slice(0, opts.maxLeaves);
  }

  const summary =
    typeof obj.summary === 'string' && obj.summary.trim()
      ? obj.summary.trim()
      : `Proposed ${kept.length} leaf loop(s) following the ${opts.workflow.name} workflow.`;

  return { plannerAlias: opts.plannerAlias, summary, leaves: kept };
}
