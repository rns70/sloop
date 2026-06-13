// Inline editor for a not-yet-executing loop: change its model, role, and plan (the
// markdown body, acceptance-criteria checklist included). Mirrors the ADR editor's
// "edit the body markdown" model — criteria live in the body's `## Acceptance criteria`
// section, the on-disk source of truth, so they're edited as checklist items here.
//
// Persistence goes through `updateLoop`, which the server gates to pre-execution
// statuses; a 409 (the loop started running in another tab) surfaces inline.

import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  getModels,
  getRoles,
  updateLoop,
  type LoopDoc,
  type ModelOption,
  type RoleDef,
} from '../../api-client/index';
import { Button, MarkdownEditor, PropertyRow } from '../../design/index';

export interface LoopEditorProps {
  cascadeId: string;
  loop: LoopDoc;
  /** Called after a successful save (the caller re-fetches and leaves edit mode). */
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}

const SELECT_CLASS =
  'rounded-md border border-line bg-white px-2 py-1 text-[13px] text-ink-muted ' +
  'focus:border-accent focus:outline-none disabled:opacity-50';

/** Ensure the loop's current value is always selectable, even if the library dropped it. */
function withCurrent(options: string[], current: string): string[] {
  return options.includes(current) ? options : [current, ...options];
}

export function LoopEditor({ cascadeId, loop, onSaved, onCancel }: LoopEditorProps) {
  const fm = loop.frontmatter;
  const [body, setBody] = useState(loop.body);
  const [model, setModel] = useState(fm.model);
  const [role, setRole] = useState(fm.role);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getRoles()
      .then((r) => active && setRoles(r))
      .catch(() => undefined);
    getModels()
      .then((m) => active && setModels(m))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const roleOptions = useMemo(() => {
    const byId = new Map(roles.map((r) => [r.id, r.name] as const));
    return withCurrent(
      roles.map((r) => r.id),
      fm.role,
    ).map((id) => ({ id, name: byId.get(id) ?? id }));
  }, [roles, fm.role]);

  const modelOptions = useMemo(
    () => withCurrent(models.map((m) => m.alias), fm.model),
    [models, fm.model],
  );

  const dirty = body !== loop.body || model !== fm.model || role !== fm.role;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateLoop(cascadeId, fm.id, { body, model, role });
      await onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : 'Failed to save the loop.',
      );
      setSaving(false);
    }
  };

  return (
    <section className="mt-6 border-t border-line-hair pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
          Editing loop
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <PropertyRow label="Role">
          <select
            className={SELECT_CLASS}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={saving}
          >
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </PropertyRow>
        <PropertyRow label="Model">
          <select
            className={SELECT_CLASS}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={saving}
          >
            {modelOptions.map((alias) => (
              <option key={alias} value={alias}>
                {alias}
              </option>
            ))}
          </select>
        </PropertyRow>
      </div>

      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
        Plan &amp; acceptance criteria
      </div>
      <div className="rounded-md border border-line p-2">
        <MarkdownEditor value={body} onChange={setBody} />
      </div>

      {error && <div className="mt-2 text-[12px] text-status-failed">{error}</div>}
    </section>
  );
}
