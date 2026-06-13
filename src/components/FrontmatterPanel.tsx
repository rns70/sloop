import type { ChangeEvent } from "react";
import type { DocStatus, LoopDoc } from "../shared/types";

type LoopFrontmatterField = "id" | "type" | "status" | "autoApply";

const statuses: DocStatus[] = [
  "idle",
  "running",
  "paused",
  "evaluating",
  "passing",
  "passed",
  "failed",
  "archived"
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function evalText(value: unknown): string {
  if (typeof value === "string") return value;
  return asString(asRecord(value).text);
}

export function updateLoopFrontmatter(
  frontmatter: Record<string, unknown>,
  field: LoopFrontmatterField,
  value: string | boolean
): Record<string, unknown> {
  return {
    ...frontmatter,
    loop: {
      ...asRecord(frontmatter.loop),
      [field]: value
    }
  };
}

export function FrontmatterPanel({
  doc,
  draftFrontmatter,
  dirty,
  saving,
  onChange,
  onSave
}: {
  doc: LoopDoc;
  draftFrontmatter: Record<string, unknown>;
  dirty: boolean;
  saving: boolean;
  onChange: (frontmatter: Record<string, unknown>) => void;
  onSave: () => void;
}) {
  const loop = asRecord(draftFrontmatter.loop);
  const stages = Array.isArray(loop.stages) ? loop.stages.map(asRecord) : doc.stages;
  const evals = Array.isArray(draftFrontmatter.evals) ? draftFrontmatter.evals : doc.evals;
  const outputs = stringList(draftFrontmatter.outputs);
  const commands = stringList(draftFrontmatter.commands);

  function handleTextChange(field: Extract<LoopFrontmatterField, "id" | "type">) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      onChange(updateLoopFrontmatter(draftFrontmatter, field, event.currentTarget.value));
    };
  }

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(updateLoopFrontmatter(draftFrontmatter, "status", event.currentTarget.value));
  }

  function handleAutoApplyChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(updateLoopFrontmatter(draftFrontmatter, "autoApply", event.currentTarget.checked));
  }

  return (
    <section className="frontmatter-panel" aria-label="Loop metadata">
      <div className="frontmatter-head">
        <strong>Loop metadata</strong>
        <button type="button" onClick={onSave} disabled={!dirty || saving}>
          {saving ? "Saving..." : dirty ? "Save metadata" : "Saved"}
        </button>
      </div>

      <div className="metadata-grid">
        <label>
          <span>ID</span>
          <input name="loop-id" value={asString(loop.id, doc.loop.id)} onChange={handleTextChange("id")} />
        </label>
        <label>
          <span>Type</span>
          <input
            name="loop-type"
            value={asString(loop.type, doc.loop.type)}
            onChange={handleTextChange("type")}
          />
        </label>
        <label>
          <span>Status</span>
          <select
            name="loop-status"
            value={asString(loop.status, doc.loop.status)}
            onChange={handleStatusChange}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="metadata-toggle">
          <input
            name="loop-auto-apply"
            type="checkbox"
            checked={asBoolean(loop.autoApply)}
            onChange={handleAutoApplyChange}
          />
          <span>Auto-apply</span>
        </label>
      </div>

      <div className="metadata-lists">
        <section aria-label="Stages">
          <div className="metadata-list-head">
            <strong>Stages</strong>
            <span>{stages.length}</span>
          </div>
          <ol className="metadata-list">
            {stages.length === 0 ? <li>No child stages.</li> : null}
            {stages.map((stage, index) => (
              <li key={asString(stage.id, `stage-${index}`)}>
                <span>{asString(stage.title, asString(stage.doc, `Stage ${index + 1}`))}</span>
                <small>
                  {asString(stage.kind, "doc")} · {asString(stage.status, "idle")} ·{" "}
                  {asString(stage.doc, "controller pending")}
                </small>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Evaluation criteria">
          <div className="metadata-list-head">
            <strong>Evals</strong>
            <span>{evals.length}</span>
          </div>
          <ol className="metadata-list">
            {evals.length === 0 ? <li>No eval criteria.</li> : null}
            {evals.map((entry, index) => (
              <li key={`${index}-${evalText(entry)}`}>
                <span>{evalText(entry) || `Eval ${index + 1}`}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {outputs.length > 0 || commands.length > 0 ? (
        <div className="metadata-lists">
          {outputs.length > 0 ? (
            <section aria-label="Allowed outputs">
              <div className="metadata-list-head">
                <strong>Outputs</strong>
                <span>{outputs.length}</span>
              </div>
              <ul className="metadata-list">
                {outputs.map((output) => (
                  <li key={output}>
                    <span>{output}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {commands.length > 0 ? (
            <section aria-label="Commands">
              <div className="metadata-list-head">
                <strong>Commands</strong>
                <span>{commands.length}</span>
              </div>
              <ul className="metadata-list">
                {commands.map((command) => (
                  <li key={command}>
                    <span>{command}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
