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
    expect(fileMoveTarget('databank/auth/a.md', 'databank/api')).toBe('databank/api/a.md');
    expect(fileMoveTarget('databank/auth/a.md', 'databank')).toBe('databank/a.md');
  });

  it('folderMoveTarget joins the folder name onto the destination folder', () => {
    expect(folderMoveTarget('databank/auth', 'databank/api')).toBe('databank/api/auth');
    expect(folderMoveTarget('databank/auth/oauth', 'databank')).toBe('databank/oauth');
  });

  it('fileRenameTarget swaps the slug, keeping the dir and .md suffix', () => {
    expect(fileRenameTarget('databank/auth/a.md', 'Better Name')).toBe('databank/auth/better-name.md');
    expect(fileRenameTarget('databank/a.md', 'b')).toBe('databank/b.md');
  });

  it('folderRenameTarget swaps the last segment', () => {
    expect(folderRenameTarget('databank/auth/oauth', 'OIDC')).toBe('databank/auth/oidc');
    expect(folderRenameTarget('databank/auth', 'identity')).toBe('databank/identity');
  });

  it('isRedundantMove flags same-parent file moves and folder self/descendant drops', () => {
    expect(isRedundantMove('file', 'databank/auth/a.md', 'databank/auth')).toBe(true); // same parent
    expect(isRedundantMove('file', 'databank/auth/a.md', 'databank/api')).toBe(false);
    expect(isRedundantMove('folder', 'databank/auth', 'databank/auth')).toBe(true); // onto self
    expect(isRedundantMove('folder', 'databank/auth', 'databank/auth/oauth')).toBe(true); // descendant
    expect(isRedundantMove('folder', 'databank/auth', 'databank')).toBe(true); // same parent
    expect(isRedundantMove('folder', 'databank/auth', 'databank/api')).toBe(false);
  });
});
