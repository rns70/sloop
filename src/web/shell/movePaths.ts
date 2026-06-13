// Pure path math for Databank drag-to-move and rename. No I/O, no React — so it can be
// unit-tested under the node test env. All paths are loops-prefixed (e.g.
// `loops/auth/a.md`); the tree root folder is `loops`.

import { slugify } from './createItem';

/** Last `/`-segment of a path. */
function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** Everything before the last `/`-segment. */
function dirname(p: string): string {
  return p.slice(0, p.lastIndexOf('/'));
}

/** Destination relPath when a file is dropped into `destFolder`. */
export function fileMoveTarget(fileRelPath: string, destFolder: string): string {
  return `${destFolder}/${basename(fileRelPath)}`;
}

/** Destination folder path when a folder is dropped into `destFolder`. */
export function folderMoveTarget(folderPath: string, destFolder: string): string {
  return `${destFolder}/${basename(folderPath)}`;
}

/** Destination relPath when a file is renamed to display name `name`. */
export function fileRenameTarget(fileRelPath: string, name: string): string {
  return `${dirname(fileRelPath)}/${slugify(name)}.md`;
}

/** Destination folder path when a folder is renamed to display name `name`. */
export function folderRenameTarget(folderPath: string, name: string): string {
  return `${dirname(folderPath)}/${slugify(name)}`;
}

/** True when a drop should be ignored: a no-op (same parent) or an illegal folder move
 *  onto itself or one of its descendants. */
export function isRedundantMove(
  kind: 'file' | 'folder',
  sourcePath: string,
  destFolder: string,
): boolean {
  if (kind === 'file') {
    return dirname(sourcePath) === destFolder;
  }
  if (destFolder === sourcePath || destFolder.startsWith(`${sourcePath}/`)) return true; // self/descendant
  return dirname(sourcePath) === destFolder; // already there
}
