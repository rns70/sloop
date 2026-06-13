import { describe, it, expect } from 'vitest';
import {
  fileMoveTarget,
  folderMoveTarget,
  fileRenameTarget,
  folderRenameTarget,
  isRedundantMove,
} from './movePaths';

describe('movePaths', () => {
  it('fileMoveTarget joins the basename onto the destination folder', () => {
    expect(fileMoveTarget('loops/auth/a.md', 'loops/api')).toBe('loops/api/a.md');
    expect(fileMoveTarget('loops/auth/a.md', 'loops')).toBe('loops/a.md');
  });

  it('folderMoveTarget joins the folder name onto the destination folder', () => {
    expect(folderMoveTarget('loops/auth', 'loops/api')).toBe('loops/api/auth');
    expect(folderMoveTarget('loops/auth/oauth', 'loops')).toBe('loops/oauth');
  });

  it('fileRenameTarget swaps the slug, keeping the dir and .md suffix', () => {
    expect(fileRenameTarget('loops/auth/a.md', 'Better Name')).toBe('loops/auth/better-name.md');
    expect(fileRenameTarget('loops/a.md', 'b')).toBe('loops/b.md');
  });

  it('folderRenameTarget swaps the last segment', () => {
    expect(folderRenameTarget('loops/auth/oauth', 'OIDC')).toBe('loops/auth/oidc');
    expect(folderRenameTarget('loops/auth', 'identity')).toBe('loops/identity');
  });

  it('isRedundantMove flags same-parent file moves and folder self/descendant drops', () => {
    expect(isRedundantMove('file', 'loops/auth/a.md', 'loops/auth')).toBe(true); // same parent
    expect(isRedundantMove('file', 'loops/auth/a.md', 'loops/api')).toBe(false);
    expect(isRedundantMove('folder', 'loops/auth', 'loops/auth')).toBe(true); // onto self
    expect(isRedundantMove('folder', 'loops/auth', 'loops/auth/oauth')).toBe(true); // descendant
    expect(isRedundantMove('folder', 'loops/auth', 'loops')).toBe(true); // same parent
    expect(isRedundantMove('folder', 'loops/auth', 'loops/api')).toBe(false);
  });
});
