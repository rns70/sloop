// One library file (a role or a template) opened in the shared markdown editor, driven
// by the route `/libraries/:type/:id`. Selection lives in the URL now (the sidebar links
// straight here) — there is no Libraries overview page. The frontmatter (model / stages)
// is shown alongside; the editor edits the markdown body (brief | guidance), and Save
// round-trips through putFile → `PUT /api/files/:relPath`.

import { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getRoles,
  getTemplates,
  putFile,
  type RoleDef,
  type TemplateDef,
} from '../../api-client/index';
import { Button, EditableTitle, MarkdownEditor, Page, Tag, roleTone } from '../../design/index';
import { serializeRole, serializeTemplate } from '../../shell/createItem';

type LibType = 'roles' | 'templates';

const isLibType = (t: string | undefined): t is LibType => t === 'roles' || t === 'templates';

export function LibraryFile() {
  const { type, id = '' } = useParams<{ type: string; id: string }>();

  if (!isLibType(type)) return <Navigate to="/libraries" replace />;
  return <LibraryEditor type={type} id={id} />;
}

function LibraryEditor({ type, id }: { type: LibType; id: string }) {
  const isRole = type === 'roles';
  const relPath = isRole ? `.sloop/roles/${id}.md` : `.sloop/templates/${id}.md`;
  const [searchParams] = useSearchParams();
  const isNew = searchParams.get('new') === '1';

  const [role, setRole] = useState<RoleDef | null>(null);
  const [template, setTemplate] = useState<TemplateDef | null>(null);
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
    setTemplate(null);

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
      : getTemplates().then((ts) => {
          const def = ts.find((t) => t.id === id);
          if (cancelled) return;
          if (!def) return setError(`No template "${id}"`);
          setTemplate(def);
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

  const def = isRole ? role : template;
  const dirty = def !== null && (content !== original || name !== originalName);

  const save = () => {
    if (!def) return;
    setSaving(true);
    setNote(null);
    // Reconstruct the whole file (frontmatter + body) — putFile writes raw content, so
    // sending only the body would drop the role's model / template's stages.
    const fileContent = role
      ? serializeRole({ id: role.id, name, defaultModel: role.defaultModel, color: role.color }, content)
      : serializeTemplate({ id: (template as TemplateDef).id, name, stages: (template as TemplateDef).stages }, content);
    putFile(relPath, fileContent)
      .then(() => {
        setOriginal(content);
        setOriginalName(name);
        setNote('Saved');
      })
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setSaving(false));
  };

  return (
    <Page
      prose
      breadcrumb={
        <span>
          Libraries / {isRole ? 'Roles' : 'Templates'} / {def?.name ?? id}
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
          ) : template ? (
            <div className="mb-5 mt-1 text-[13px] text-ink-faint">
              {template.stages.map((s) => s.name).join(' → ')}
            </div>
          ) : null}
          <MarkdownEditor key={relPath} value={content} onChange={setContent} />
        </>
      )}
    </Page>
  );
}
