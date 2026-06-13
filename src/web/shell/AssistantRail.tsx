import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getModels, type ModelOption } from '../api-client/index';
import { Button, Label, cx } from '../design/index';
import { useAssistant } from '../assistant/AssistantContext';
import { useAssistantChat } from '../assistant/useAssistantChat';

export function AssistantRail({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { openDoc } = useAssistant();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [alias, setAlias] = useState('');
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getModels()
      .then((opts) => { setModels(opts); setAlias((a) => a || opts[0]?.alias || ''); })
      .catch((e: unknown) => setModelsError(e instanceof Error ? e.message : String(e)));
  }, []);

  const onWrote = (paths: string[]) => {
    const last = paths[paths.length - 1];
    if (last?.startsWith('databank/')) navigate(`/databank/${last.replace(/^databank\//, '')}`);
    else if (last) navigate('/libraries');
  };

  const { messages, streaming, error, send, stop } = useAssistantChat({ model: alias || undefined, onWrote });

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  const submit = () => { const t = draft.trim(); if (!t || streaming) return; setDraft(''); void send(t); };

  return (
    <aside className={cx('flex w-[380px] shrink-0 flex-col border-l border-line-hair bg-sidebar text-[13px]', className)}>
      <div className="border-b border-line-hair px-4 py-3">
        <Label>Assistant</Label>
        <select
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          disabled={models.length === 0}
          className="mt-2 w-full rounded border border-line-soft bg-paper px-2 py-1 text-[12px] text-ink-muted outline-none focus:border-accent disabled:opacity-60"
        >
          {models.length === 0
            ? <option value="">No models configured (.sloop/config.md)</option>
            : models.map((m) => <option key={m.alias} value={m.alias}>{m.alias} — {m.provider} / {m.id}</option>)}
        </select>
        <div className="mt-1 text-[11px] text-ink-faint">{openDoc ? `Context: ${openDoc.relPath}` : 'Context: whole app'}</div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <p className="text-[12px] text-ink-faint">Ask a question, or tell me to edit or create an ADR, role, or template. Changes apply directly.</p>}
        {messages.map((m, i) => (
          <div key={i} className={cx('rounded-md px-3 py-2', m.role === 'user' ? 'bg-line-soft' : 'border border-line-soft bg-paper')}>
            <div className="mb-1 text-[10px] uppercase tracking-[0.07em] text-ink-faint">{m.role}</div>
            <pre className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink">{m.text || (streaming && i === messages.length - 1 ? '…' : '')}</pre>
            {m.tools?.map((t, j) => (
              <div key={j} className="mt-1 font-mono text-[11px] text-ink-faint">{t.ok ? '✎' : '⚠'} {t.tool}{t.path ? ` ${t.path}` : ''}</div>
            ))}
          </div>
        ))}
        {(error || modelsError) && <p className="text-[12px] text-status-failed">{error ?? modelsError}</p>}
      </div>

      <div className="border-t border-line-hair px-4 py-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={3}
          placeholder="Message the assistant…  (Enter to send, Shift+Enter for newline)"
          className="w-full resize-y rounded border border-line-soft bg-paper px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <div className="mt-2 flex gap-2">
          {streaming
            ? <Button variant="subtle" onClick={stop}>Stop</Button>
            : <Button variant="primary" disabled={!draft.trim()} onClick={submit}>Send</Button>}
        </div>
      </div>
    </aside>
  );
}
