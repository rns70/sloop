import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAdrs, getModels, getRoles, getWorkflows, putAdr, putFile, requestAssistant,
  type AssistantProposal, type ModelOption,
} from '../api-client/index';
import { Button, Label, cx } from '../design/index';
import { useAssistant } from '../assistant/AssistantContext';
import { planWrite, type ExistingIds } from '../assistant/planWrite';

/** Read the current live id/path sets for collision-safe creates. */
async function loadExisting(): Promise<ExistingIds> {
  const [adrs, roles, workflows] = await Promise.all([getAdrs(), getRoles(), getWorkflows()]);
  return {
    adrPaths: adrs.map((a) => a.relPath),
    roleIds: roles.map((r) => r.id),
    templateIds: workflows.map((t) => t.id),
  };
}

export function AssistantRail({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { openDoc } = useAssistant();

  const [models, setModels] = useState<ModelOption[]>([]);
  const [alias, setAlias] = useState('');
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    getModels()
      .then((opts) => { setModels(opts); setAlias((a) => a || opts[0]?.alias || ''); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const contextPaths = useMemo(() => (openDoc ? [openDoc.relPath] : []), [openDoc]);

  async function run() {
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy(true); setError(null); setNote(null); setProposal(null);
    try {
      setProposal(await requestAssistant({ instruction: text, contextPaths, model: alias || undefined }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!proposal || busy) return;
    setBusy(true); setError(null);
    try {
      // Edit of the doc open in the editor → inline accept/reject diff (no API write).
      if (proposal.action === 'edit' && openDoc && proposal.targetPath === openDoc.relPath) {
        openDoc.applyInline(openDoc.getValue(), proposal.content);
        setNote('Applied as an inline diff in the editor.');
        setProposal(null); setInstruction('');
        return;
      }
      const plan = planWrite(proposal, await loadExisting());
      if (plan.kind === 'edit') {
        const adr = (await getAdrs()).find((a) => a.relPath === plan.relPath);
        if (!adr) throw new Error(`Cannot edit unknown doc: ${plan.relPath}`);
        await putAdr(plan.relPath, { ...adr, body: plan.content });
        navigate(`/databank/${plan.relPath.replace(/^databank\//, '')}`);
      } else if (plan.kind === 'create-adr') {
        await putAdr(plan.relPath, plan.doc);
        navigate(`/databank/${plan.relPath.replace(/^databank\//, '')}`);
      } else if (plan.kind === 'create-file') {
        await putFile(plan.relPath, plan.content);
        navigate('/libraries');
      }
      setProposal(null); setInstruction('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const isAnswer = proposal?.action === 'answer';

  return (
    <aside className={cx('flex w-80 shrink-0 flex-col border-l border-line-hair bg-sidebar px-4 py-3 text-[13px]', className)}>
      <Label>Assistant</Label>

      <div className="mt-2">
        <select
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          disabled={models.length === 0}
          className="w-full rounded border border-line-soft bg-paper px-2 py-1 text-[12px] text-ink-muted outline-none focus:border-accent disabled:opacity-60"
        >
          {models.length === 0 ? (
            <option value="">No models configured (.sloop/config.md)</option>
          ) : (
            models.map((m) => (
              <option key={m.alias} value={m.alias}>{m.alias} — {m.provider} / {m.id}</option>
            ))
          )}
        </select>
      </div>

      <div className="mt-2 text-[11px] text-ink-faint">
        {openDoc ? `Context: ${openDoc.relPath}` : 'Context: none (whole app)'}
      </div>

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={4}
        placeholder="Ask, edit a doc, or create an ADR / role / workflow…"
        className="mt-2 w-full resize-y rounded border border-line-soft bg-paper px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
      />

      <div className="mt-2">
        <Button variant="primary" disabled={busy || !instruction.trim()} onClick={() => void run()}>
          {busy ? 'Working…' : 'Send'}
        </Button>
      </div>

      {error && <p className="mt-2 text-[12px] text-status-failed">{error}</p>}
      {note && <p className="mt-2 text-[12px] text-ink-faint">{note}</p>}

      {proposal && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md bg-line-soft px-3 py-2">
          <div className="mb-1 text-[11px] uppercase tracking-[0.07em] text-ink-faint">
            {isAnswer ? 'Answer' : 'Proposal'}
          </div>
          {!isAnswer && <p className="mb-2 text-[12px] font-medium text-ink">{proposal.summary}</p>}
          {!isAnswer && proposal.targetPath && (
            <p className="mb-2 font-mono text-[11px] text-ink-faint">{proposal.targetPath}</p>
          )}
          <pre className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink">{proposal.content}</pre>
          {!isAnswer && (
            <div className="mt-2 flex gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
                {proposal.action === 'edit' ? 'Apply' : 'Create'}
              </Button>
              <Button variant="subtle" disabled={busy} onClick={() => setProposal(null)}>Discard</Button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
