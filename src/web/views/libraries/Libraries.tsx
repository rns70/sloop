// Libraries: roles and templates as quiet lists; selecting one opens its markdown in
// the shared editor (frontmatter → properties, body → editable brief/guidance).
//
// Viewing works against today's mock because role/template bodies come back on the
// typed getRoles/getTemplates responses. Save round-trips through putFile → the
// canonical `PUT /api/files/:relPath`, which the backend wires in WP-6.

import { useEffect, useState } from 'react';
import {
  getRoles,
  getTemplates,
  putFile,
  type RoleDef,
  type TemplateDef,
} from '../../api-client/index';
import { Button, Label, MarkdownEditor, Page, Tag, roleTone } from '../../design/index';

type Selection =
  | { kind: 'role'; def: RoleDef }
  | { kind: 'template'; def: TemplateDef }
  | null;

function relPathFor(sel: NonNullable<Selection>): string {
  return sel.kind === 'role'
    ? `.sloop/roles/${sel.def.id}.md`
    : `.sloop/templates/${sel.def.id}.md`;
}

function bodyOf(sel: NonNullable<Selection>): string {
  return sel.kind === 'role' ? sel.def.brief : sel.def.guidance;
}

export function Libraries() {
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [templates, setTemplates] = useState<TemplateDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getRoles(), getTemplates()])
      .then(([r, t]) => {
        setRoles(r);
        setTemplates(t);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const open = (next: NonNullable<Selection>) => {
    setSel(next);
    setContent(bodyOf(next));
    setOriginal(bodyOf(next));
    setNote(null);
  };

  const dirty = sel !== null && content !== original;

  const save = () => {
    if (!sel) return;
    setSaving(true);
    setNote(null);
    putFile(relPathFor(sel), content)
      .then(() => {
        setOriginal(content);
        setNote('Saved');
      })
      .catch(() => setNote('Save lands with WP-6 (no /api/files in the mock yet)'))
      .finally(() => setSaving(false));
  };

  // ---- Detail (editor) view ----
  if (sel) {
    return (
      <Page
        prose
        breadcrumb={
          <button type="button" onClick={() => setSel(null)} className="hover:underline">
            ← Libraries / {sel.kind === 'role' ? 'Roles' : 'Templates'} / {sel.def.name}
          </button>
        }
        actions={
          <>
            {note && (
              <span className="text-[12px] text-ink-faint">{note}</span>
            )}
            <Button variant="primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <h1 className="text-[20px] font-bold tracking-[-0.01em]">{sel.def.name}</h1>
        {sel.kind === 'role' ? (
          <div className="mb-5 mt-1 flex items-center gap-2.5 text-[13px] text-ink-faint">
            <span>default model</span>
            <span className="text-ink-muted">{sel.def.defaultModel}</span>
            <Tag tone={roleTone(sel.def.id)}>{sel.def.name}</Tag>
          </div>
        ) : (
          <div className="mb-5 mt-1 text-[13px] text-ink-faint">
            {sel.def.stages.map((s) => s.name).join(' → ')}
          </div>
        )}
        <MarkdownEditor key={relPathFor(sel)} value={content} onChange={setContent} />
      </Page>
    );
  }

  // ---- List view ----
  return (
    <Page breadcrumb="Libraries">
      <h1 className="text-[23px] font-bold tracking-[-0.01em]">Libraries</h1>
      <p className="mt-1 text-[13.5px] text-ink-faint">
        Roles (who does the work) and templates (the shape of the tree) — markdown files, edited
        in the same shared editor.
      </p>

      {error && <p className="mt-6 text-[13px] text-status-failed">Failed to load libraries: {error}</p>}

      {!error && (
        <div className="mt-7 flex gap-9">
          <section className="flex-1">
            <SectionHead title="Roles" />
            <div className="border-t border-line-soft">
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => open({ kind: 'role', def: r })}
                  className="flex w-full items-center gap-2.5 border-b border-line-soft px-1 py-2 text-left transition-colors hover:bg-line-soft"
                >
                  <Tag tone={roleTone(r.id)}>{r.name}</Tag>
                  <span className="ml-auto text-[12.5px] text-ink-faint">{r.defaultModel}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="flex-1">
            <SectionHead title="Templates" />
            <div className="border-t border-line-soft">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => open({ kind: 'template', def: t })}
                  className="block w-full border-b border-line-soft px-1 py-2 text-left transition-colors hover:bg-line-soft"
                >
                  <div className="flex text-[13.5px]">
                    <span>{t.id}</span>
                    {t.id === 'spec-driven' && (
                      <span className="ml-auto text-[12px] text-ink-subtle">default</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-faint">
                    {t.stages.map((s) => s.name).join(' → ')}
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </Page>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <div className="mb-2.5 flex items-center">
      <span className="text-[16px] font-semibold">{title}</span>
      <Label className="ml-auto normal-case tracking-normal text-ink-subtle">+ New</Label>
    </div>
  );
}
