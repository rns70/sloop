import type { FileDiff, HistoryEntry } from "../shared/types";

interface HistoryPanelProps {
  history: HistoryEntry[];
  selectedDiff?: FileDiff;
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
}

function InlineDiffPreview({ diff }: { diff?: FileDiff }) {
  if (!diff || diff.lines.length === 0) {
    return <p className="notice">No diff for the selected document.</p>;
  }

  return (
    <div className="inline-diff" aria-label="Inline diff">
      {diff.lines.slice(0, 24).map((line, index) => (
        <span key={`${line.type}-${index}-${line.text}`} className={`diff-line ${line.type}`}>
          {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "} {line.text}
        </span>
      ))}
    </div>
  );
}

export function HistoryPanel({
  history,
  selectedDiff,
  open,
  onClose,
  onToggle
}: HistoryPanelProps) {
  return (
    <>
      <button
        type="button"
        className="history-trigger"
        aria-expanded={open}
        aria-controls={open ? "history-drawer" : undefined}
        onClick={onToggle}
      >
        History
      </button>

      {open ? (
        <aside id="history-drawer" className="history-drawer" aria-label="History drawer">
          <div className="history-drawer-head">
            <strong>History</strong>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>

          <section className="history-drawer-section">
            <div className="surface-head">
              <strong>Selected diff</strong>
              <span>{selectedDiff?.path ?? "No file selected"}</span>
            </div>
            <InlineDiffPreview diff={selectedDiff} />
          </section>

          <section className="history-drawer-section">
            <div className="surface-head">
              <strong>Runs</strong>
              <span>{history.length} entries</span>
            </div>
            <ol className="history-list">
              {history.length === 0 ? <li>No run history yet.</li> : null}
              {history.map((entry) => (
                <li key={`${entry.id}-${entry.kind}-${entry.createdAt}`}>
                  <time dateTime={entry.createdAt}>{entry.createdAt}</time>
                  <strong>{entry.title}</strong>
                  <span>
                    {entry.kind} {entry.status}: {entry.summary}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      ) : null}
    </>
  );
}
