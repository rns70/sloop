import { type CSSProperties, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { FileDiff, HistoryEntry, LoopDoc, LoopRun, WorkspaceSummary } from "./shared/types";
import {
  createProject,
  createRun,
  getGitDiff,
  getDoc,
  getHistory,
  getWorkspace,
  listRuns,
  openProject,
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
  entries: DirectoryEntry[];
}

interface DirectoryEntry {
  path: string;
  name: string;
  doc?: LoopDoc;
}

function createDirectoryNode(name: string, path: string): DirectoryNode {
  return {
    name,
    path,
    directories: new Map(),
    entries: []
  };
}

function buildDirectoryTree(files: string[], docs: LoopDoc[]): DirectoryNode {
  const root = createDirectoryNode("", "");
  const docsByPath = new Map(docs.map((doc) => [doc.path, doc]));
  const paths = [...new Set([...files, ...docs.map((doc) => doc.path)])].sort((a, b) =>
    a.localeCompare(b)
  );

  paths.forEach((path) => {
    const parts = path.split("/");
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
    current.entries.push({
      path,
      name: fileName,
      doc: docsByPath.get(path)
    });
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
  const entries = [...node.entries].sort((left, right) => left.path.localeCompare(right.path));

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
      {entries.map((entry) => {
        const selected = entry.path === selectedPath;
        const label = entry.doc ? shortDocName(entry.path) : entry.name;

        return (
          <li key={entry.path}>
            {entry.doc ? (
              <button
                type="button"
                className={selected ? "selected" : undefined}
                onClick={() => onOpenDoc(entry.path)}
                aria-current={selected ? "page" : undefined}
                style={{ "--depth": depth } as CSSProperties}
              >
                <span className={`file-status ${entry.doc.loop.status}`} aria-hidden="true" />
                <span className="file-text">
                  <span>{label}</span>
                </span>
              </button>
            ) : (
              <div className="file-entry" style={{ "--depth": depth } as CSSProperties}>
                <span className="file-status plain" aria-hidden="true" />
              <span className="file-text">
                <span>{label}</span>
              </span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function DocumentRail({
  files,
  docs,
  workspaceRoot,
  selectedPath,
  onOpenProject,
  onCreateProject,
  onOpenDoc
}: {
  files: string[];
  docs: LoopDoc[];
  workspaceRoot?: string;
  selectedPath: string;
  onOpenProject: () => void;
  onCreateProject: () => void;
  onOpenDoc: (path: string) => void;
}) {
  const tree = buildDirectoryTree(files, docs);
  const directoryNumbers = buildDirectoryNumbers(docs);

  return (
    <nav className="rail" aria-label="Files">
      <div className="rail-title">
        <div>
          <strong>Sloop</strong>
          <span title={workspaceRoot}>{workspaceRoot ?? "No workspace"}</span>
        </div>
        <span>{docs.length} docs</span>
      </div>
      <div className="rail-actions" aria-label="Workspace actions">
        <button type="button" onClick={onOpenProject}>
          Open
        </button>
        <button type="button" onClick={onCreateProject}>
          New
        </button>
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
              <dt>source</dt>
              <dd>{run.sourcePath}</dd>
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

  const refresh = useCallback(async (preferredSelectedPath = selectedPath) => {
    const [workspaceResult, diffResult, historyResult, runsResult] = await Promise.all([
      getWorkspace(),
      getGitDiff(),
      getHistory(),
      listRuns()
    ]);
    const nextSelectedPath =
      workspaceResult.docs.some((workspaceDoc) => workspaceDoc.path === preferredSelectedPath)
        ? preferredSelectedPath
        : workspaceResult.docs[0]?.path ?? "";
    if (nextSelectedPath !== preferredSelectedPath) {
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

  async function handleSaveDocument() {
    if (!doc) return;
    setSavingFrontmatter(true);
    setError("");
    try {
      const body = editor.blocksToMarkdownLossy(editor.document);
      const savedDoc = await saveDoc(doc.path, {
        frontmatter: draftFrontmatter,
        body
      });
      setDoc(savedDoc);
      setDraftFrontmatter(savedDoc.frontmatter);
      setFrontmatterDirty(false);
      await refresh(savedDoc.path);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not save document");
    } finally {
      setSavingFrontmatter(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;

      event.preventDefault();
      void handleSaveDocument();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

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

  async function handleOpenProject() {
    const path = window.prompt("Open project folder", workspace?.root ?? "");
    if (!path?.trim()) return;

    setError("");
    try {
      await openProject(path);
      setSelectedPath("");
      setRun(undefined);
      await refresh("");
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : "Could not open project";
      if (/does not exist|ENOENT|no such file/i.test(message)) {
        const shouldCreate = window.confirm(
          `That folder does not exist.\n\nCreate a new Sloop project at:\n${path}`
        );
        if (shouldCreate) {
          try {
            await createProject(path);
            setSelectedPath("");
            setRun(undefined);
            await refresh("");
            return;
          } catch (createError) {
            setError(createError instanceof Error ? createError.message : "Could not create project");
            return;
          }
        }
      }

      setError(message);
    }
  }

  async function handleCreateProject() {
    const path = window.prompt("Create project folder", workspace?.root ? `${workspace.root}/sloop-project` : "");
    if (!path?.trim()) return;

    setError("");
    try {
      await createProject(path);
      setSelectedPath("");
      setRun(undefined);
      await refresh("");
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not create project");
    }
  }

  function handleFrontmatterChange(nextFrontmatter: Record<string, unknown>) {
    setDraftFrontmatter(nextFrontmatter);
    setFrontmatterDirty(true);
  }

  return (
    <main className="app-shell">
      <DocumentRail
        files={workspace?.files ?? []}
        docs={workspace?.docs ?? []}
        workspaceRoot={workspace?.root}
        selectedPath={selectedPath}
        onOpenProject={handleOpenProject}
        onCreateProject={handleCreateProject}
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
              onSave={handleSaveDocument}
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
