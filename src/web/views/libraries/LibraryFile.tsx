// One library file (a role or a workflow) opened in the shared markdown editor, driven
// by the route `/libraries/:type/:id`. Selection lives in the URL now (the sidebar links
// straight here) — there is no Libraries overview page. The frontmatter (model / steps)
// is shown alongside; the editor edits the markdown body (brief | guidance), and Save
// round-trips through putFile → `PUT /api/files/:relPath`.

import { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getRoles,
  getWorkflows,
  putFile,
  type RoleDef,
  type WorkflowDef,
} from '../../api-client/index';
import { Button, EditableTitle, MarkdownEditor, Page, Tag, roleTone } from '../../design/index';
import { serializeRole, serializeWorkflow } from '../../shell/createItem';
import { useRegisterSave } from '../../shell/EditorActionsContext';

type LibType = 'roles' | 'workflows';

const isLibType = (t: string | undefined): t is LibType => t === 'roles' || t === 'workflows';

export function LibraryFile() {
  const { type, id = '' } = useParams<{ type: string; id: string }>();

  if (!isLibType(type)) return <Navigate to="/libraries" replace />;
  return <LibraryEditor type={type} id={id} />;
}

function LibraryEditor({ type, id }: { type: LibType; id: string }) {
  const isRole = type === 'roles';
  const relPath = isRole ? `.sloop/roles/${id}.md` : `.sloop/workflows/${id}.md`;
  const [searchParams] = useSearchParams();
  const isNew = searchParams.get('new') === '1';

  const [role, setRole] = useState<RoleDef | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNote(null);
    setRole(null);
    setWorkflow(null);

    const load = isRole
      ? getRoles().then((rs) => {
          const def = rs.find((r) => r.id === id);
          if (cancelled) return;
          if (!def) return setError(`No role "${id}"`);
          setRole(def);
          setName(def.name);
          setOriginalName(def.name);
          setContent(def.brief);
          setOriginal(def.brief);
        })
      : getWorkflows().then((ts) => {
          const def = ts.find((t) => t.id === id);
          if (cancelled) return;
          if (!def) return setError(`No workflow "${id}"`);
          setWorkflow(def);
          setName(def.name);
          setOriginalName(def.name);
          setContent(def.guidance);
          setOriginal(def.guidance);
        });

    load.catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [isRole, id]);

  const def = isRole ? role : workflow;
  const dirty = def !== null && (content !== original || name !== originalName);

  const save = () => {
    if (!def) return;
    setSaving(true);
    setNote(null);
    // Reconstruct the whole file (frontmatter + body) — putFile writes raw content, so
    // sending only the body would drop the role's model / workflow's steps.
    const fileContent = role
      ? serializeRole({ id: role.id, name, defaultModel: role.defaultModel, color: role.color }, content)
      : serializeWorkflow({ id: (workflow as WorkflowDef).id, name, steps: (workflow as WorkflowDef).steps }, content);
    putFile(relPath, fileContent)
      .then(() => {
        setOriginal(content);
        setOriginalName(name);
        setNote('Saved');
      })
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setSaving(false));
  };

  // Expose Save to the app-level Cmd+S hotkey and the command palette.
  useRegisterSave(save, dirty && !saving);

  return (
    <Page
      prose
      breadcrumb={
        <span>
          Libraries / {isRole ? 'Roles' : 'Workflows'} / {def?.name ?? id}
        </span>
      }
      actions={
        def && (
          <>
            {note && <span className="text-[12px] text-ink-faint">{note}</span>}
            <Button variant="primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        )
      }
    >
      {error && <p className="text-[13px] text-status-failed">{error}</p>}
      {!error && !def && <p className="text-[13px] text-ink-faint">Loading…</p>}

      {def && (
        <>
          <EditableTitle value={name} onChange={setName} autoFocus={isNew} />
          {role ? (
            <div className="mb-5 mt-1 flex items-center gap-2.5 text-[13px] text-ink-faint">
              <span>default model</span>
              <span className="text-ink-muted">{role.defaultModel}</span>
              <Tag tone={roleTone(role.id)}>{name || role.name}</Tag>
            </div>
          ) : workflow ? (
            <div className="mb-5 mt-1 text-[13px] text-ink-faint">
              {workflow.steps.map((s) => s.name).join(' → ')}
            </div>
          ) : null}
          <MarkdownEditor key={relPath} value={content} onChange={setContent} />
        </>
      )}
    </Page>
  );
}
