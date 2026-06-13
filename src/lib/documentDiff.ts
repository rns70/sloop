import type { DiffLine, FileDiff, LoopDoc } from "../shared/types";

export type InlineDiffLineKind = DiffLine["type"];

export interface InlineDiffLine {
  id: string;
  kind: InlineDiffLineKind;
  text: string;
  symbol: " " | "+" | "-";
  oldLineNumber?: number;
  newLineNumber?: number;
}

export function toInlineDiffLines(diff: FileDiff | undefined): InlineDiffLine[] {
  if (!diff) {
    return [];
  }

  let oldLineNumber = 1;
  let newLineNumber = 1;

  return diff.lines.map((line, index) => {
    const oldLine = line.type === "add" ? undefined : oldLineNumber;
    const newLine = line.type === "remove" ? undefined : newLineNumber;

    if (line.type !== "add") {
      oldLineNumber += 1;
    }

    if (line.type !== "remove") {
      newLineNumber += 1;
    }

    return {
      id: `${diff.path}:${index}`,
      kind: line.type,
      text: line.text,
      symbol: diffSymbol(line.type),
      oldLineNumber: oldLine,
      newLineNumber: newLine
    };
  });
}

export function findDiffForSelectedDoc(
  diffs: FileDiff[],
  selectedDoc: LoopDoc | string | null | undefined
): FileDiff | undefined {
  const selectedPath = normalizeDiffPath(typeof selectedDoc === "string" ? selectedDoc : selectedDoc?.path);

  if (!selectedPath) {
    return undefined;
  }

  return diffs.find((diff) => normalizeDiffPath(diff.path) === selectedPath);
}

export function getInlineDiffForSelectedDoc(
  diffs: FileDiff[],
  selectedDoc: LoopDoc | string | null | undefined
): InlineDiffLine[] {
  return toInlineDiffLines(findDiffForSelectedDoc(diffs, selectedDoc));
}

function normalizeDiffPath(path: string | undefined): string {
  return path?.replace(/\\/g, "/").replace(/^\.?\//, "") ?? "";
}

function diffSymbol(type: DiffLine["type"]): InlineDiffLine["symbol"] {
  if (type === "add") {
    return "+";
  }

  if (type === "remove") {
    return "-";
  }

  return " ";
}
