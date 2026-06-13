import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { getModels, type ModelOption } from '../api-client/index';
import { Button, Label, cx } from '../design/index';
import { useAssistant } from '../assistant/AssistantContext';
import { useAssistantChat } from '../assistant/useAssistantChat';

const TEXTAREA_MAX_HEIGHT = 220; // ~10 rows

/** Navigate to the right app location for a written path (DRY — reused by onWrote and chip clicks). */
function useGoToPath() {
  const navigate = useNavigate();
  return (path: string) => {
    if (path.startsWith('databank/')) navigate(`/databank/${path.replace(/^databank\//, '')}`);
    else navigate('/libraries');
  };
}

export function AssistantRail({ className }: { className?: string }) {
  const goToPath = useGoToPath();
  const { openDoc } = useAssistant();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [alias, setAlias] = useState('');
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // Refs for scroll management and textarea auto-grow.
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    getModels()
      .then((opts) => { setModels(opts); setAlias((a) => a || opts[0]?.alias || ''); })
      .catch((e: unknown) => setModelsError(e instanceof Error ? e.message : String(e)));
  }, []);

  const onWrote = (paths: string[]) => {
    const last = paths[paths.length - 1];
    if (last) goToPath(last);
  };

  const { messages, streaming, error, send, stop } = useAssistantChat({ model: alias || undefined, onWrote });

  // Track whether the user is near the bottom.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Auto-scroll: only when user is near the bottom, or after the user sent a message.
  useEffect(() => {
    if (atBottomRef.current) {
      scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
    }
  }, [messages]);

  // Auto-grow textarea: reset height then apply min(scrollHeight, MAX).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [draft]);

  const submit = () => {
    const t = draft.trim();
    if (!t || streaming) return;
    setDraft('');
    // Reset textarea height to min.
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    // Force scroll to bottom when user sends.
    atBottomRef.current = true;
    void send(t);
  };

  // Model availability hints.
  const noKeysConfigured = models.length > 0 && models.every((m) => m.available === false);
  const selectedUnavailable = models.find((m) => m.alias === alias)?.available === false;

  return (
    <aside className={cx('flex w-[380px] shrink-0 flex-col border-l border-line-hair bg-sidebar text-[13px]', className)}>
      <div className="border-b border-line-hair px-4 py-3">
        <Label>Assistant</Label>
        <select
          aria-label="Model"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          disabled={models.length === 0 || streaming}
          className="mt-2 w-full rounded border border-line-soft bg-paper px-2 py-1 text-[12px] text-ink-muted outline-none focus:border-accent disabled:opacity-60"
        >
          {models.length === 0
            ? <option value="">No models configured (.sloop/config.md)</option>
            : models.map((m) => (
                <option key={m.alias} value={m.alias} disabled={m.available === false}>
                  {m.alias} — {m.provider} / {m.id}{m.available === false ? ' · no key' : ''}
                </option>
              ))}
        </select>
        {noKeysConfigured ? (
          <div className="mt-1 text-[11px] text-status-failed">
            No provider API key set. Add ANTHROPIC_API_KEY or NEBIUS_API_KEY to your .env and restart the server.
          </div>
        ) : selectedUnavailable ? (
          <div className="mt-1 text-[11px] text-status-failed">
            This model&apos;s provider key isn&apos;t set — pick another model or add its key.
          </div>
        ) : null}
        <div className="mt-1 text-[11px] text-ink-faint">{openDoc ? `Context: ${openDoc.relPath}` : 'Context: whole app'}</div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-atomic={false}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && (
          <p className="text-[12px] text-ink-faint">
            Ask a question, or tell me to edit or create an ADR, role, or workflow. Changes apply directly.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cx('rounded-md px-3 py-2', m.role === 'user' ? 'bg-line-soft' : 'border border-line-soft bg-paper')}>
            <div className="mb-1 text-[10px] uppercase tracking-[0.07em] text-ink-faint">{m.role}</div>

            {m.role === 'user' ? (
              /* User messages: preserve literal text */
              m.text && (
                <pre className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink">{m.text}</pre>
              )
            ) : (
              /* Assistant messages: render markdown */
              <>
                {m.text && (
                  <div className="text-[12.5px] leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-line-soft [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11.5px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-line-soft [&_pre]:p-2 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
                    <ReactMarkdown>{m.text}</ReactMarkdown>
                    {streaming && i === messages.length - 1 && (
                      <span className="ml-px inline-block h-[0.95em] w-[2px] animate-pulse bg-ink align-text-bottom" />
                    )}
                  </div>
                )}
              </>
            )}

            {m.tools?.map((t, j) => {
              const clickable = t.ok && Boolean(t.path);
              return clickable ? (
                <button
                  key={j}
                  type="button"
                  onClick={() => goToPath(t.path!)}
                  className="mt-1 block cursor-pointer font-mono text-[11px] text-ink-faint hover:underline"
                >
                  ✎ {t.tool} {t.path}
                </button>
              ) : (
                <div key={j} className="mt-1 font-mono text-[11px] text-ink-faint">
                  {t.ok ? '✎' : '⚠'} {t.tool}{t.path ? ` ${t.path}` : ''}
                </div>
              );
            })}

            {streaming && i === messages.length - 1 && !m.text && (
              <div className="flex items-center gap-2 text-[12px] text-ink-faint">
                <span className="flex gap-1" aria-hidden>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
                </span>
                <span>{(m.tools?.length ?? 0) > 0 ? 'Working…' : 'Thinking…'}</span>
              </div>
            )}
          </div>
        ))}
        {(error || modelsError) && <p className="text-[12px] text-status-failed">{error ?? modelsError}</p>}
      </div>

      <div className="border-t border-line-hair px-4 py-3">
        <div className="relative rounded border border-line-soft bg-paper focus-within:border-accent">
          <textarea
            ref={textareaRef}
            aria-label="Message the assistant"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
              if (e.key === 'Escape' && streaming) { e.preventDefault(); stop(); }
            }}
            rows={3}
            placeholder="Message the assistant…"
            style={{ maxHeight: `${TEXTAREA_MAX_HEIGHT}px` }}
            className="w-full resize-none overflow-y-auto rounded bg-transparent px-2 py-1.5 pb-11 text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="absolute bottom-1.5 right-1.5">
            {streaming
              ? <Button variant="subtle" onClick={stop}>Stop</Button>
              : <Button variant="primary" disabled={!draft.trim()} onClick={submit}>Send</Button>}
          </div>
        </div>
        <div className="mt-1 px-1 text-[10px] text-ink-faint">Enter to send · Shift+Enter for newline · Esc to stop</div>
      </div>
    </aside>
  );
}
