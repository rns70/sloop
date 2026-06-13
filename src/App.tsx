import { type CSSProperties, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { FileDiff, HistoryEntry, LoopDoc, LoopRun, WorkspaceSummary } from "./shared/types";
import {
  createRun,
  getGitDiff,
  getDoc,
  getHistory,
  getWorkspace,
  listRuns,
  pauseRun,
  resumeRun,
  runEval,
  runPiCascade,
  saveDoc
} from "./lib/api";
import {
  bottomSectionsReducer,
  createClosedBottomSections,
  type BottomSectionsState
} from "./lib/bottomSections";
import { HistoryPanel } from "./components/HistoryPanel";
import { findDiffForSelectedDoc } from "./lib/documentDiff";
import { FrontmatterPanel } from "./components/FrontmatterPanel";

function ErrorNotice({ message }: { message: string }) {
  return <p className="notice error">{message}</p>;
}

function StatusFooter({
  doc,
  workspace,
  selectedPath,
  history,
  runs,
  run,
  onRun,
  onPause,
  onResume,
  onCreateRun,
  onEval,
  onToggleGraph,
  onToggleConsole,
  running,
  openSections,
  onOpenDoc
}: {
  doc: LoopDoc;
  workspace: WorkspaceSummary | null;
  selectedPath: string;
  history: HistoryEntry[];
  runs: LoopRun[];
  run?: LoopRun;
  running: boolean;
  openSections: BottomSectionsState;
  onRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onCreateRun: () => void;
  onEval: () => void;
  onToggleGraph: () => void;
  onToggleConsole: () => void;
  onOpenDoc: (path: string) => void;
}) {
  return (
    <footer className="loop-status">
      <div className="bottom-sections" aria-label="Document sections">
        <section className="bottom-section">
          <button
            type="button"
            className="section-header"
            onClick={onToggleGraph}
            aria-expanded={openSections.graph}
            aria-controls="graph-drawer"
          >
            <strong>Graph</strong>
            <span>{openSections.graph ? "Close" : "Open"}</span>
          </button>
          {openSections.graph ? (
            <GraphDrawer
              id="graph-drawer"
              workspace={workspace}
              selectedPath={selectedPath}
              onOpenDoc={onOpenDoc}
            />
          ) : null}
        </section>
        <section className="bottom-section">
          <button
            type="button"
            className="section-header"
            onClick={onToggleConsole}
            aria-expanded={openSections.console}
            aria-controls="console-drawer"
          >
            <strong>Console</strong>
            <span>{openSections.console ? "Close" : "Open"}</span>
          </button>
          {openSections.console ? (
            <ConsoleDrawer
              id="console-drawer"
              history={history}
              runs={runs}
              run={run}
              running={running}
              onCreateRun={onCreateRun}
              onPause={onPause}
              onResume={onResume}
              onEval={onEval}
            />
          ) : null}
        </section>
      </div>

      <div className="status-head">
        <strong>Loop status</strong>
        <span>
          {doc.loop.type} loop {doc.loop.status}. {doc.stages.length} child loops.{" "}
          {doc.loop.autoApply ? "Auto-apply after passing evals." : "Manual apply."}
        </span>
        <div className="status-actions">
          <button type="button" onClick={onPause} disabled={!run}>
            Pause
          </button>
          <button type="button" onClick={onResume} disabled={!run}>
            Resume
          </button>
          <button type="button" onClick={onRun} disabled={running}>
            {running ? "Running..." : "Run Pi cascade"}
          </button>
        </div>
      </div>

      <ul className="status-list">
        {doc.stages.map((stage) => (
          <li key={stage.id}>
            <button type="button" onClick={() => onOpenDoc(stage.doc)}>
              {stage.doc}
            </button>
            <span className={stage.status}>{stage.status}</span>
            <span>{stage.kind}</span>
            <span>{stage.agent ?? "pi"}</span>
            {stage.outputs.length > 0 ? <span>{stage.outputs.join(", ")}</span> : null}
          </li>
        ))}
      </ul>

      {run ? (
        <p className="notice">
          Last run {run.status}: {run.changedFiles.join(", ")}
        </p>
      ) : null}
    </footer>
  );
}

function shortDocName(path: string): string {
  const parts = path.split("/");
  return parts.at(-1)?.replace(/\.md$/i, "") ?? path;
}

function stepPrefix(index: number): string {
  return String(index).padStart(2, "0");
}

interface DirectoryNode {
  name: string;
  path: string;
  directories: Map<string, DirectoryNode>;
  docs: LoopDoc[];
}

function createDirectoryNode(name: string, path: string): DirectoryNode {
  return {
    name,
    path,
    directories: new Map(),
    docs: []
  };
}

function buildDirectoryTree(docs: LoopDoc[]): DirectoryNode {
  const root = createDirectoryNode("", "");

  docs.forEach((workspaceDoc) => {
    const parts = workspaceDoc.path.split("/");
    const fileName = parts.at(-1);
    if (!fileName) return;

    let current = root;
    parts.slice(0, -1).forEach((part) => {
      const nextPath = current.path ? `${current.path}/${part}` : part;
      const existing = current.directories.get(part);
      if (existing) {
        current = existing;
        return;
      }

      const next = createDirectoryNode(part, nextPath);
      current.directories.set(part, next);
      current = next;
    });
    current.docs.push(workspaceDoc);
  });

  return root;
}

function buildDirectoryNumbers(docs: LoopDoc[]): Map<string, string> {
  const directorySteps = new Map<string, string[]>();
  const childPaths = new Set<string>();

  docs.forEach((workspaceDoc) => {
    workspaceDoc.stages.forEach((stage) => childPaths.add(stage.doc.trim()));
  });

  const rootLoopDocs = docs.filter(
    (workspaceDoc) => workspaceDoc.stages.length > 0 && !childPaths.has(workspaceDoc.path)
  );
  const numberingSources = rootLoopDocs.length > 0 ? rootLoopDocs : docs;

  numberingSources.forEach((workspaceDoc) => {
    workspaceDoc.stages.forEach((stage, index) => {
      const directory = stage.doc.trim().split("/").slice(0, -1).join("/");
      if (!directory) return;

      directorySteps.set(directory, [...(directorySteps.get(directory) ?? []), stepPrefix(index)]);
    });
  });

  const numbers = new Map<string, string>();
  directorySteps.forEach((steps, directory) => {
    const uniqueSteps = [...new Set(steps)].sort();
    numbers.set(
      directory,
      uniqueSteps.length === 1 ? uniqueSteps[0] : `${uniqueSteps[0]}-${uniqueSteps.at(-1)}`
    );
  });

  return numbers;
}

function DirectoryTree({
  node,
  selectedPath,
  directoryNumbers,
  onOpenDoc,
  depth = 0
}: {
  node: DirectoryNode;
  selectedPath: string;
  directoryNumbers: Map<string, string>;
  onOpenDoc: (path: string) => void;
  depth?: number;
}) {
  const directories = [...node.directories.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  const docs = [...node.docs].sort((left, right) => left.path.localeCompare(right.path));

  return (
    <ol className={depth === 0 ? "file-tree" : "file-branch"}>
      {directories.map((directory) => (
        <li key={directory.path}>
          <div className="folder-label" style={{ "--depth": depth } as CSSProperties}>
            {directoryNumbers.has(directory.path)
              ? `${directoryNumbers.get(directory.path)} ${directory.name}`
              : directory.name}
          </div>
          <DirectoryTree
            node={directory}
            selectedPath={selectedPath}
            directoryNumbers={directoryNumbers}
            onOpenDoc={onOpenDoc}
            depth={depth + 1}
          />
        </li>
      ))}
      {docs.map((workspaceDoc) => {
        const selected = workspaceDoc.path === selectedPath;
        const label = shortDocName(workspaceDoc.path);

        return (
          <li key={workspaceDoc.path}>
            <button
              type="button"
              className={selected ? "selected" : undefined}
              onClick={() => onOpenDoc(workspaceDoc.path)}
              aria-current={selected ? "page" : undefined}
              style={{ "--depth": depth } as CSSProperties}
            >
              <span className={`file-status ${workspaceDoc.loop.status}`} aria-hidden="true" />
              <span className="file-text">
                <span>{label}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function DocumentRail({
  docs,
  selectedPath,
  onOpenDoc
}: {
  docs: LoopDoc[];
  selectedPath: string;
  onOpenDoc: (path: string) => void;
}) {
  const tree = buildDirectoryTree(docs);
  const directoryNumbers = buildDirectoryNumbers(docs);

  return (
    <nav className="rail" aria-label="Files">
      <div className="rail-title">
        <strong>Sloop</strong>
        <span>{docs.length} docs</span>
      </div>
      <DirectoryTree
        node={tree}
        selectedPath={selectedPath}
        directoryNumbers={directoryNumbers}
        onOpenDoc={onOpenDoc}
      />
    </nav>
  );
}

function buildDagLines(docs: LoopDoc[], selectedPath: string): string[] {
  const docsByPath = new Map(docs.map((workspaceDoc) => [workspaceDoc.path, workspaceDoc]));
  const roots = docsByPath.has(selectedPath) ? [selectedPath] : docs.map((workspaceDoc) => workspaceDoc.path);
  const visited = new Set<string>();
  const lines: string[] = [];

  function walk(path: string, depth: number) {
    const workspaceDoc = docsByPath.get(path);
    const prefix = `${"  ".repeat(depth)}${depth === 0 ? "" : "- "}`;

    if (!workspaceDoc) {
      lines.push(`${prefix}${path} (missing doc)`);
      return;
    }

    if (visited.has(path)) {
      lines.push(`${prefix}${workspaceDoc.path} (${workspaceDoc.loop.status}, already shown)`);
      return;
    }

    visited.add(path);
    lines.push(
      `${prefix}${workspaceDoc.path} [${workspaceDoc.loop.type}; ${workspaceDoc.loop.status}; ${workspaceDoc.stages.length} stages]`
    );

    workspaceDoc.stages.forEach((stage) => {
      lines.push(`${"  ".repeat(depth + 1)}- ${stage.title}: ${stage.doc} (${stage.status})`);
      walk(stage.doc, depth + 2);
    });
  }

  roots.forEach((path) => walk(path, 0));
  return lines;
}

function GraphDrawer({
  id,
  workspace,
  selectedPath,
  onOpenDoc
}: {
  id: string;
  workspace: WorkspaceSummary | null;
  selectedPath: string;
  onOpenDoc: (path: string) => void;
}) {
  const lines = buildDagLines(workspace?.docs ?? [], selectedPath);

  return (
    <section id={id} className="secondary-surface" aria-label="Workspace DAG">
      <div className="surface-head">
        <strong>Graph</strong>
        <span>{workspace?.docs.length ?? 0} docs</span>
      </div>
      {lines.length === 0 ? (
        <p className="notice">No graph data loaded yet.</p>
      ) : (
        <pre className="dag-text">
          {lines.map((line, index) => {
            const docPath = workspace?.docs.find((workspaceDoc) => line.includes(workspaceDoc.path))?.path;
            return docPath ? (
              <button key={`${index}-${line}`} type="button" onClick={() => onOpenDoc(docPath)}>
                {line}
              </button>
            ) : (
              <span key={`${index}-${line}`}>{line}</span>
            );
          })}
        </pre>
      )}
    </section>
  );
}

function ConsoleDrawer({
  id,
  history,
  runs,
  run,
  running,
  onCreateRun,
  onPause,
  onResume,
  onEval
}: {
  id: string;
  history: HistoryEntry[];
  runs: LoopRun[];
  run?: LoopRun;
  running: boolean;
  onCreateRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onEval: () => void;
}) {
  const recentLogs = [...history]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 8);

  return (
    <section id={id} className="secondary-surface" aria-label="Run console">
      <div className="surface-head">
        <strong>Console</strong>
        <span>Pi runtime</span>
        <div className="surface-actions">
          <button type="button" onClick={onCreateRun} disabled={running}>
            {running ? "Running..." : "Create run"}
          </button>
          <button type="button" onClick={onPause} disabled={!run}>
            Pause
          </button>
          <button type="button" onClick={onResume} disabled={!run}>
            Resume
          </button>
          <button type="button" onClick={onEval} disabled={!run}>
            Eval
          </button>
        </div>
      </div>

      <dl className="runtime-info">
        <div>
          <dt>runtime</dt>
          <dd>{run?.runtime ?? "pi"}</dd>
        </div>
        <div>
          <dt>last run</dt>
          <dd>{run ? `${run.id} (${run.status})` : "none"}</dd>
        </div>
        <div>
          <dt>listed runs</dt>
          <dd>{runs.length === 0 ? "unavailable or empty" : runs.length}</dd>
        </div>
      </dl>

      {run ? (
        <div className="run-detail">
          <strong>Run detail</strong>
          <dl className="runtime-info">
            <div>
              <dt>branch</dt>
              <dd>{run.branchName ?? "none"}</dd>
            </div>
            <div>
              <dt>worktree</dt>
              <dd>{run.worktreePath ?? "none"}</dd>
            </div>
            <div>
              <dt>archived</dt>
              <dd>{run.archived ? "yes" : "no"}</dd>
            </div>
          </dl>
          <ul className="evidence-list">
            {run.changedFiles.length > 0 ? (
              <li>Changed files: {run.changedFiles.join(", ")}</li>
            ) : (
              <li>No changed files reported.</li>
            )}
            {run.eval.evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {(run.log ?? []).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ol className="console-log">
        {recentLogs.length === 0 ? <li>No recent run logs.</li> : null}
        {recentLogs.map((entry) => (
          <li key={`${entry.id}-${entry.kind}-${entry.createdAt}`}>
            <time>{entry.createdAt}</time>
            <strong>{entry.title}</strong>
            <span>
              {entry.kind} {entry.status}: {entry.summary}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function App() {
  const editor = useCreateBlockNote();
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [doc, setDoc] = useState<LoopDoc | null>(null);
  const [draftFrontmatter, setDraftFrontmatter] = useState<Record<string, unknown>>({});
  const [frontmatterDirty, setFrontmatterDirty] = useState(false);
  const [savingFrontmatter, setSavingFrontmatter] = useState(false);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [runs, setRuns] = useState<LoopRun[]>([]);
  const [run, setRun] = useState<LoopRun | undefined>();
  const [openSections, dispatchOpenSections] = useReducer(
    bottomSectionsReducer,
    undefined,
    createClosedBottomSections
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  const selectedDiff = useMemo(
    () => findDiffForSelectedDoc(diffs, selectedPath),
    [diffs, selectedPath]
  );

  const refresh = useCallback(async () => {
    const [workspaceResult, diffResult, historyResult, runsResult] = await Promise.all([
      getWorkspace(),
      getGitDiff(),
      getHistory(),
      listRuns()
    ]);
    const nextSelectedPath =
      workspaceResult.docs.some((workspaceDoc) => workspaceDoc.path === selectedPath)
        ? selectedPath
        : workspaceResult.docs[0]?.path ?? "";
    if (nextSelectedPath !== selectedPath) {
      setSelectedPath(nextSelectedPath);
    }

    setWorkspace(workspaceResult);
    setDiffs(diffResult);
    setHistory(historyResult);
    setRuns(runsResult ?? []);
    setRun((currentRun) => {
      const refreshedRuns = runsResult ?? [];
      if (currentRun) {
        return refreshedRuns.find((refreshedRun) => refreshedRun.id === currentRun.id) ?? currentRun;
      }

      return refreshedRuns[0];
    });

    if (!nextSelectedPath) {
      setDoc(null);
      setDraftFrontmatter({});
      setFrontmatterDirty(false);
      const blocks = editor.tryParseMarkdownToBlocks("No loop documents found.");
      editor.replaceBlocks(editor.document, blocks);
      return;
    }

    const docResult = await getDoc(nextSelectedPath);
    setDoc(docResult);
    setDraftFrontmatter(docResult.frontmatter);
    setFrontmatterDirty(false);
    const blocks = editor.tryParseMarkdownToBlocks(docResult.body || "Start writing...");
    editor.replaceBlocks(editor.document, blocks);
  }, [editor, selectedPath]);

  useEffect(() => {
    refresh().catch((unknownError) => {
      setError(unknownError instanceof Error ? unknownError.message : "Could not load workspace");
    });
  }, [refresh]);

  async function handleRun() {
    if (!doc) return;
    setRunning(true);
    setError("");
    try {
      const result = await runPiCascade(doc.path);
      setRun(result);
      await refresh();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleCreateRun() {
    if (!doc) return;
    setRunning(true);
    setError("");
    try {
      const result = await createRun(doc.path);
      if (!result) {
        return;
      }
      setRun(result);
      await refresh();
      setRuns((currentRuns) => [result, ...currentRuns.filter((currentRun) => currentRun.id !== result.id)]);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not create run");
    } finally {
      setRunning(false);
    }
  }

  async function handlePause() {
    if (!run) return;
    setError("");
    try {
      const result = await pauseRun(run.id, doc?.path);
      if (result) {
        setRun({ ...run, status: result.status });
        setRuns((currentRuns) =>
          currentRuns.map((currentRun) =>
            currentRun.id === result.id ? { ...currentRun, status: result.status } : currentRun
          )
        );
        await refresh();
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not pause run");
    }
  }

  async function handleResume() {
    if (!run) return;
    setError("");
    try {
      const result = await resumeRun(run.id, doc?.path);
      if (result) {
        setRun({ ...run, status: result.status });
        setRuns((currentRuns) =>
          currentRuns.map((currentRun) =>
            currentRun.id === result.id ? { ...currentRun, status: result.status } : currentRun
          )
        );
        await refresh();
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not resume run");
    }
  }

  async function handleEval() {
    if (!run) return;
    setError("");
    try {
      await runEval(run.changedFiles, { sourcePath: doc?.path, criteria: doc?.evals });
      await refresh();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not run eval");
    }
  }

  function handleOpenDoc(path: string) {
    setSelectedPath(path);
    dispatchOpenSections({ type: "openDoc" });
    setHistoryOpen(false);
  }

  function handleToggleGraph() {
    dispatchOpenSections({ type: "toggle", section: "graph" });
  }

  function handleToggleConsole() {
    dispatchOpenSections({ type: "toggle", section: "console" });
  }

  function handleToggleHistory() {
    setHistoryOpen((open) => !open);
  }

  function handleFrontmatterChange(nextFrontmatter: Record<string, unknown>) {
    setDraftFrontmatter(nextFrontmatter);
    setFrontmatterDirty(true);
  }

  async function handleSaveFrontmatter() {
    if (!doc || !frontmatterDirty) return;
    setSavingFrontmatter(true);
    setError("");
    try {
      const savedDoc = await saveDoc(doc.path, {
        frontmatter: draftFrontmatter,
        body: doc.body
      });
      setDoc(savedDoc);
      setDraftFrontmatter(savedDoc.frontmatter);
      setFrontmatterDirty(false);
      await refresh();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not save metadata");
    } finally {
      setSavingFrontmatter(false);
    }
  }

  return (
    <main className="app-shell">
      <DocumentRail
        docs={workspace?.docs ?? []}
        selectedPath={selectedPath}
        onOpenDoc={handleOpenDoc}
      />

      <section className="workspace">
        <article className="paper">
          <div className="topline">
            <span>{(doc?.path ?? selectedPath) || "No document selected"}</span>
            <HistoryPanel
              history={history}
              selectedDiff={selectedDiff}
              open={historyOpen}
              onClose={() => setHistoryOpen(false)}
              onToggle={handleToggleHistory}
            />
          </div>

          {error ? <ErrorNotice message={error} /> : null}

          {doc ? (
            <FrontmatterPanel
              doc={doc}
              draftFrontmatter={draftFrontmatter}
              dirty={frontmatterDirty}
              saving={savingFrontmatter}
              onChange={handleFrontmatterChange}
              onSave={handleSaveFrontmatter}
            />
          ) : null}

          <BlockNoteView
            editor={editor}
            editable={Boolean(doc)}
            theme="light"
            className="sloop-editor"
          />

          {doc ? (
            <StatusFooter
              doc={doc}
              workspace={workspace}
              selectedPath={selectedPath}
              history={history}
              runs={runs}
              run={run}
              running={running}
              openSections={openSections}
              onRun={handleRun}
              onPause={handlePause}
              onResume={handleResume}
              onCreateRun={handleCreateRun}
              onEval={handleEval}
              onToggleGraph={handleToggleGraph}
              onToggleConsole={handleToggleConsole}
              onOpenDoc={handleOpenDoc}
            />
          ) : null}
        </article>
      </section>
    </main>
  );
}
