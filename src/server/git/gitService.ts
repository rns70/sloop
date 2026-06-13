import path from 'node:path';
import { promises as fs } from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { DatabankDiff, Delta } from '../../shared';
import type { GitService } from '../../shared';
import { resolveWorkspaceRoot } from '../files/filesService';

const DATABANK_PREFIX = 'loops/';

/**
 * A fixed identity so commits succeed without any global git config (important for
 * CI, fresh containers, and ephemeral demo workspaces). Passed as per-command `-c`
 * overrides, which set both the author and committer without mutating the repo's
 * config file or replacing the process environment.
 */
const SLOOP_IDENTITY = ['user.name=sloop', 'user.email=sloop@earendil.works'];

/**
 * Disk-backed `GitService` over a workspace repo. Tracks the loops as the source
 * of desired state: `diffDatabank` reports what changed in the working tree since the
 * last commit, and `commitAll` snapshots an accepted state.
 */
export class GitServiceImpl implements GitService {
  private readonly git: SimpleGit;

  constructor(private readonly root: string) {
    this.git = simpleGit({ baseDir: root, config: SLOOP_IDENTITY });
  }

  /**
   * Diff the `loops/` working tree against the last commit (HEAD). Each changed
   * file yields a `delta` derived from git status flags plus the `before` (content at
   * HEAD) and `after` (current working-tree content). New files have empty `before`;
   * deleted files have empty `after`.
   */
  async diffDatabank(): Promise<DatabankDiff> {
    const status = await this.git.status();
    const loopsFiles = status.files
      .filter((f) => f.path.startsWith(DATABANK_PREFIX))
      .sort((a, b) => a.path.localeCompare(b.path));

    const changed = await Promise.all(
      loopsFiles.map(async (f) => {
        const delta = statusToDelta(f.index, f.working_dir);
        const before = await this.showAtHead(f.path);
        const after = delta === 'delete' ? '' : await this.readWorkingTree(f.path);
        return { relPath: f.path, delta, before, after };
      }),
    );

    return { changed };
  }

  /** Stage everything, commit with the fixed sloop identity, return the 7-char sha. */
  async commitAll(message: string): Promise<string> {
    await this.git.add('.');
    await this.git.commit(message);
    const sha = await this.git.revparse(['--short=7', 'HEAD']);
    return sha.trim();
  }

  /** Content of `relPath` at HEAD, or `''` if it did not exist there. */
  private async showAtHead(relPath: string): Promise<string> {
    try {
      return await this.git.show([`HEAD:${relPath}`]);
    } catch {
      return '';
    }
  }

  /** Current working-tree content of `relPath`, or `''` if missing. */
  private async readWorkingTree(relPath: string): Promise<string> {
    try {
      return await fs.readFile(path.join(this.root, relPath), 'utf8');
    } catch {
      return '';
    }
  }
}

/** Construct a git-backed `GitService` rooted at `root` (or the env/default root). */
export function createGitService(root?: string): GitService {
  return new GitServiceImpl(resolveWorkspaceRoot(root));
}

/**
 * Map a porcelain status pair (`index`, `working_dir`) to a loops `Delta`.
 * Deletion takes precedence, then addition (staged `A` or untracked `?`); anything
 * else that shows up in status is a content change.
 */
function statusToDelta(index: string, workingDir: string): Delta {
  if (index === 'D' || workingDir === 'D') return 'delete';
  if (index === 'A' || index === '?' || workingDir === '?') return 'add';
  return 'change';
}
