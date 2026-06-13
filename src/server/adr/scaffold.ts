// Workflow-as-startup-template scaffolding. "Apply workflow W to ADR P" stamps a starter
// child-ADR tree onto P: one child ADR per workflow step, wired into P's `children`. This
// is a one-time authoring action (mirrors dev-rens' materializeDefaultCascadeForSource) —
// it is idempotent, so re-applying the same workflow never duplicates children that
// already exist (matched by their deterministic id).
//
// `children` link to child *relPaths* (the codebase's authoritative parent→child link, as
// resolved by planRunSet / AdrRunTree); the deterministic id is the child's frontmatter id
// and filename stem. Idempotency keys on the id (so re-applying skips a step whose child
// file already exists) while the link appended to the parent is the child's relPath.
//
// This module is PURE: it computes the new child documents and the parent's updated
// `children` list, but performs no IO. The caller (real.ts) persists the result via
// FilesService.writeAdr.

import path from 'node:path';
import type { AdrDoc, WorkflowDef } from '../../shared/index';
import { ADR_BODY_TEMPLATE } from '../../shared/index';

/** Slugify a step name into an id-safe fragment: lowercase, non-alphanumeric → `-`, no
 *  leading/trailing dashes. Empty input yields `step` so an id is never blank. */
export function slugifyStep(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'step';
}

/** Title-case a step name for the child ADR's display title (`code review` → `Code Review`). */
function titleCase(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Step';
  return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The result of planning a scaffold: the new child ADRs to write, and the parent's
 *  updated `children` list (existing preserved, new child relPaths appended in step order,
 *  deduped). */
export interface WorkflowScaffold {
  children: AdrDoc[];
  parentChildren: string[];
}

/**
 * Plan the child-ADR tree to stamp onto `parent` for `workflow`. For each step:
 *  - id = `<parent.id>-<slug(step.name)>`; if that id is already taken (in `existingIds`
 *    OR produced earlier in this same plan), the step is SKIPPED (idempotent — re-applying
 *    never duplicates, and two steps slugging to the same id collapse to one child).
 *  - relPath = the parent's directory + `<id>.md`.
 *  - title = title-cased step name; body = the canonical ADR body template.
 *  - role = step.role; workflow = workflow.id (provenance); status 'idle'; empty
 *    children/outputs/acceptanceCriteria.
 * The parent's `children` keeps its existing entries (deduped, order kept) and appends each
 * newly-created child's *relPath* in step order — `children` are relPath links in this
 * codebase (see planRunSet / AdrRunTree). Pure — no IO.
 */
export function planWorkflowScaffold(
  parent: AdrDoc,
  workflow: WorkflowDef,
  existingIds: Set<string>,
): WorkflowScaffold {
  const dir = path.posix.dirname(parent.relPath.split(path.sep).join('/'));
  // Track ids reserved across the whole plan so duplicate slugs / pre-existing ids skip.
  const reserved = new Set(existingIds);
  const children: AdrDoc[] = [];
  const newRelPaths: string[] = [];

  for (const step of workflow.steps) {
    const id = `${parent.id}-${slugifyStep(step.name)}`;
    if (reserved.has(id)) continue; // already exists, or an earlier step claimed it
    reserved.add(id);

    const relPath = dir && dir !== '.' ? `${dir}/${id}.md` : `${id}.md`;
    children.push({
      id,
      relPath,
      title: titleCase(step.name),
      body: ADR_BODY_TEMPLATE,
      acceptanceCriteria: [],
      children: [],
      status: 'idle',
      outputs: [],
      workflow: workflow.id,
      ...(step.role ? { role: step.role } : {}),
    });
    newRelPaths.push(relPath);
  }

  // Preserve the parent's existing children (deduped, order kept), then append new relPaths.
  const parentChildren: string[] = [];
  const seen = new Set<string>();
  for (const link of [...parent.children, ...newRelPaths]) {
    if (seen.has(link)) continue;
    seen.add(link);
    parentChildren.push(link);
  }

  return { children, parentChildren };
}
