# sloop Workspace Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `sloop-core` Rust crate that models loops and cascades as markdown-with-frontmatter files on disk, reads/writes them in a workspace, and tracks changes with git.

**Architecture:** A pure, headless library crate (no UI, no async, no agent processes). It owns the canonical mapping between on-disk markdown files and in-memory domain types, plus a thin git layer. Everything in later plans (cascade engine, executor, Tauri UI) depends on this crate and never touches the filesystem format directly.

**Tech Stack:** Rust (edition 2021), `serde` + `serde_yaml` (frontmatter), `git2` (git), `thiserror` (error types); dev-only: `tempfile` (filesystem tests).

**Design decisions carried from the spec:**
- Markdown files are the single source of truth; git is the history.
- Acceptance criteria carry **stable IDs** and an optional `verify` shell command (`exit 0 = passed`).
- This crate does NOT compute diffs, run agents, or evaluate convergence — those are later plans. It only persists and parses.

---

## File Structure

```
sloop/                         # repo root (already a git repo)
  Cargo.toml                   # workspace manifest (cargo workspace)
  crates/
    sloop-core/
      Cargo.toml
      src/
        lib.rs                 # crate root, re-exports, error type
        model/
          mod.rs               # re-exports model types
          enums.rs             # LoopKind, LoopStatus, Delta
          criterion.rs         # AcceptanceCriterion
          loop_doc.rs          # LoopFrontmatter, LoopDoc (parse/serialize)
        frontmatter.rs         # split_frontmatter() helper
        workspace.rs           # Workspace: paths, scaffold, read/write loops
        git.rs                 # GitRepo: init, commit_all
      tests/
        loop_roundtrip.rs      # integration: parse↔serialize on disk
        workspace_fs.rs        # integration: scaffold + read/write in tempdir
        git_commit.rs          # integration: init + commit in tempdir
```

Each file has one responsibility; model types are split so each stays small and holdable in context.

---

### Task 1: Cargo workspace + crate skeleton

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `crates/sloop-core/Cargo.toml`
- Create: `crates/sloop-core/src/lib.rs`

- [ ] **Step 1: Create the cargo workspace manifest**

Create `Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["crates/sloop-core"]
```

- [ ] **Step 2: Create the crate manifest**

Create `crates/sloop-core/Cargo.toml`:
```toml
[package]
name = "sloop-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_yaml = "0.9"
git2 = "0.18"
thiserror = "1"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Create the crate root with the error type**

Create `crates/sloop-core/src/lib.rs`:
```rust
pub mod model;
pub mod frontmatter;
pub mod workspace;
pub mod git;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
    #[error("malformed document: {0}")]
    Malformed(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo build -p sloop-core`
Expected: builds with warnings about empty modules being unresolved — so create empty module files next before this passes. Run after Step 5.

- [ ] **Step 5: Create empty module files so the crate compiles**

Create `crates/sloop-core/src/model/mod.rs`:
```rust
pub mod enums;
pub mod criterion;
pub mod loop_doc;

pub use enums::{Delta, LoopKind, LoopStatus};
pub use criterion::AcceptanceCriterion;
pub use loop_doc::{LoopDoc, LoopFrontmatter};
```

Create empty placeholder files (filled in later tasks), each with a single line so modules resolve:
- `crates/sloop-core/src/model/enums.rs` → `// filled in Task 2`
- `crates/sloop-core/src/model/criterion.rs` → `// filled in Task 3`
- `crates/sloop-core/src/model/loop_doc.rs` → `// filled in Task 4/5`
- `crates/sloop-core/src/frontmatter.rs` → `// filled in Task 4`
- `crates/sloop-core/src/workspace.rs` → `// filled in Task 6`
- `crates/sloop-core/src/git.rs` → `// filled in Task 8`

Note: `model/mod.rs` re-exports symbols that don't exist yet, so the build will fail until Task 2/3. That is expected — proceed to Step 6 to commit the scaffold, then Task 2.

- [ ] **Step 6: Commit the scaffold**

```bash
git add Cargo.toml crates/sloop-core
git commit -m "feat: scaffold sloop-core crate and cargo workspace"
```

---

### Task 2: Domain enums

**Files:**
- Modify: `crates/sloop-core/src/model/enums.rs`
- Test: `crates/sloop-core/src/model/enums.rs` (inline `#[cfg(test)]`)

- [ ] **Step 1: Write the failing test**

Replace the contents of `crates/sloop-core/src/model/enums.rs` with the enums plus tests:
```rust
use serde::{Deserialize, Serialize};

/// Where a loop sits in the tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoopKind {
    Architect,
    Inner,
    Leaf,
}

/// Lifecycle state of a loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoopStatus {
    Planned,
    AwaitingApproval,
    Queued,
    Executing,
    Blocked,
    Review,
    Done,
    Failed,
}

/// The kind of databank change that spawned a loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Delta {
    Add,
    Change,
    Delete,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loop_status_serializes_snake_case() {
        let yaml = serde_yaml::to_string(&LoopStatus::AwaitingApproval).unwrap();
        assert_eq!(yaml.trim(), "awaiting_approval");
    }

    #[test]
    fn loop_kind_roundtrips() {
        let parsed: LoopKind = serde_yaml::from_str("architect").unwrap();
        assert_eq!(parsed, LoopKind::Architect);
    }

    #[test]
    fn delta_roundtrips() {
        let parsed: Delta = serde_yaml::from_str("delete").unwrap();
        assert_eq!(parsed, Delta::Delete);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail/then pass**

Run: `cargo test -p sloop-core enums`
Expected: compiles and PASSES (these enums are self-contained). If `model/mod.rs` re-exports still break the build, confirm Task 1 Step 5 created `criterion.rs`/`loop_doc.rs` with placeholders; the re-export of `AcceptanceCriterion`/`LoopDoc` will fail to compile until Task 3/5. To unblock, temporarily comment the not-yet-defined re-exports in `model/mod.rs`, leaving only `pub use enums::{Delta, LoopKind, LoopStatus};`.

- [ ] **Step 3: Commit**

```bash
git add crates/sloop-core/src/model/enums.rs crates/sloop-core/src/model/mod.rs
git commit -m "feat: add LoopKind, LoopStatus, Delta enums"
```

---

### Task 3: AcceptanceCriterion

**Files:**
- Modify: `crates/sloop-core/src/model/criterion.rs`

- [ ] **Step 1: Write the type and a round-trip test**

Replace `crates/sloop-core/src/model/criterion.rs`:
```rust
use serde::{Deserialize, Serialize};

/// A single verifiable condition. `id` is stable across cascades so deltas map
/// deterministically. If `verify` is set, the criterion passes when that shell
/// command exits 0; otherwise a QA-role loop adjudicates (later plan).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcceptanceCriterion {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_passed_false_and_no_verify() {
        let c: AcceptanceCriterion =
            serde_yaml::from_str("id: ac-1\ntext: tokens rotate").unwrap();
        assert_eq!(c.id, "ac-1");
        assert!(!c.passed);
        assert_eq!(c.verify, None);
    }

    #[test]
    fn verify_omitted_when_none() {
        let c = AcceptanceCriterion {
            id: "ac-1".into(),
            text: "x".into(),
            passed: false,
            verify: None,
        };
        let yaml = serde_yaml::to_string(&c).unwrap();
        assert!(!yaml.contains("verify"));
    }
}
```

- [ ] **Step 2: Re-enable the re-export**

Ensure `crates/sloop-core/src/model/mod.rs` includes `pub use criterion::AcceptanceCriterion;` (uncomment if you commented it in Task 2).

- [ ] **Step 3: Run tests**

Run: `cargo test -p sloop-core criterion`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add crates/sloop-core/src/model/criterion.rs crates/sloop-core/src/model/mod.rs
git commit -m "feat: add AcceptanceCriterion with stable id and optional verify"
```

---

### Task 4: Frontmatter splitter

**Files:**
- Modify: `crates/sloop-core/src/frontmatter.rs`

- [ ] **Step 1: Write the failing test + function signature**

Replace `crates/sloop-core/src/frontmatter.rs`:
```rust
use crate::CoreError;

/// Splits a markdown document into its YAML frontmatter and body.
/// Expects a leading `---\n ... \n---\n` fence. Returns (yaml, body).
pub fn split_frontmatter(input: &str) -> Result<(String, String), CoreError> {
    let rest = input.strip_prefix("---\n").ok_or_else(|| {
        CoreError::Malformed("document does not start with '---' fence".into())
    })?;
    let end = rest
        .find("\n---\n")
        .ok_or_else(|| CoreError::Malformed("missing closing '---' fence".into()))?;
    let yaml = rest[..end].to_string();
    let body = rest[end + "\n---\n".len()..].to_string();
    Ok((yaml, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_yaml_and_body() {
        let doc = "---\nid: x\n---\n# Title\n\nbody text\n";
        let (yaml, body) = split_frontmatter(doc).unwrap();
        assert_eq!(yaml, "id: x");
        assert_eq!(body, "# Title\n\nbody text\n");
    }

    #[test]
    fn errors_without_leading_fence() {
        let err = split_frontmatter("# no frontmatter\n").unwrap_err();
        assert!(matches!(err, CoreError::Malformed(_)));
    }

    #[test]
    fn errors_without_closing_fence() {
        let err = split_frontmatter("---\nid: x\nno close\n").unwrap_err();
        assert!(matches!(err, CoreError::Malformed(_)));
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p sloop-core frontmatter`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add crates/sloop-core/src/frontmatter.rs
git commit -m "feat: add split_frontmatter helper"
```

---

### Task 5: LoopDoc parse + serialize round-trip

**Files:**
- Modify: `crates/sloop-core/src/model/loop_doc.rs`
- Test: `crates/sloop-core/tests/loop_roundtrip.rs`

- [ ] **Step 1: Write LoopFrontmatter + LoopDoc**

Replace `crates/sloop-core/src/model/loop_doc.rs`:
```rust
use serde::{Deserialize, Serialize};

use crate::frontmatter::split_frontmatter;
use crate::model::{AcceptanceCriterion, Delta, LoopKind, LoopStatus};
use crate::CoreError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoopFrontmatter {
    pub id: String,
    pub kind: LoopKind,
    pub role: String,
    pub model: String,
    pub status: LoopStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta: Option<Delta>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_adr: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub acceptance_criteria: Vec<AcceptanceCriterion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executor: Option<String>,
}

/// A loop on disk: YAML frontmatter + a markdown body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoopDoc {
    pub frontmatter: LoopFrontmatter,
    pub body: String,
}

impl LoopDoc {
    /// Parse a full markdown document (fence + body) into a LoopDoc.
    pub fn parse(input: &str) -> Result<Self, CoreError> {
        let (yaml, body) = split_frontmatter(input)?;
        let frontmatter: LoopFrontmatter = serde_yaml::from_str(&yaml)?;
        Ok(LoopDoc { frontmatter, body })
    }

    /// Serialize back to a full markdown document with a `---` fence.
    pub fn to_markdown(&self) -> Result<String, CoreError> {
        let yaml = serde_yaml::to_string(&self.frontmatter)?;
        // serde_yaml ends with a trailing newline; build a clean fenced doc.
        Ok(format!("---\n{}---\n{}", yaml, self.body))
    }
}
```

- [ ] **Step 2: Write the round-trip integration test**

Create `crates/sloop-core/tests/loop_roundtrip.rs`:
```rust
use sloop_core::model::{LoopDoc, LoopKind, LoopStatus};

const SAMPLE: &str = "---\n\
id: adr-007-rotate-tokens\n\
kind: inner\n\
role: engineer\n\
model: sonnet\n\
status: executing\n\
delta: change\n\
parent: _architect\n\
children:\n\
- update-token-service\n\
source_adr: adr-007\n\
acceptance_criteria:\n\
- id: ac-1\n\
  text: refresh tokens rotate\n\
  passed: false\n\
---\n\
# Plan\n\nrotate the tokens\n";

#[test]
fn parses_expected_fields() {
    let doc = LoopDoc::parse(SAMPLE).unwrap();
    assert_eq!(doc.frontmatter.id, "adr-007-rotate-tokens");
    assert_eq!(doc.frontmatter.kind, LoopKind::Inner);
    assert_eq!(doc.frontmatter.status, LoopStatus::Executing);
    assert_eq!(doc.frontmatter.children, vec!["update-token-service"]);
    assert_eq!(doc.frontmatter.acceptance_criteria.len(), 1);
    assert!(doc.body.contains("rotate the tokens"));
}

#[test]
fn roundtrips_through_markdown() {
    let doc = LoopDoc::parse(SAMPLE).unwrap();
    let rendered = doc.to_markdown().unwrap();
    let reparsed = LoopDoc::parse(&rendered).unwrap();
    assert_eq!(doc, reparsed);
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p sloop-core --test loop_roundtrip`
Expected: PASS (2 tests).

- [ ] **Step 4: Confirm the whole crate builds and all tests pass**

Run: `cargo test -p sloop-core`
Expected: all tests from Tasks 2–5 PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/sloop-core/src/model/loop_doc.rs crates/sloop-core/tests/loop_roundtrip.rs
git commit -m "feat: add LoopDoc parse/to_markdown with round-trip"
```

---

### Task 6: Workspace paths + scaffold

**Files:**
- Modify: `crates/sloop-core/src/workspace.rs`
- Test: `crates/sloop-core/tests/workspace_fs.rs`

- [ ] **Step 1: Write the Workspace type**

Replace `crates/sloop-core/src/workspace.rs`:
```rust
use std::fs;
use std::path::{Path, PathBuf};

use crate::Result;

/// A sloop workspace rooted at a directory on disk.
pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    /// Open (do not create) a workspace at `root`.
    pub fn open(root: impl AsRef<Path>) -> Self {
        Workspace {
            root: root.as_ref().to_path_buf(),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn databank_dir(&self) -> PathBuf {
        self.root.join("databank")
    }

    pub fn cascades_dir(&self) -> PathBuf {
        self.root.join("cascades")
    }

    pub fn sloop_dir(&self) -> PathBuf {
        self.root.join(".sloop")
    }

    /// Create the standard directory layout if missing. Idempotent.
    pub fn ensure_scaffold(&self) -> Result<()> {
        for dir in [
            self.databank_dir(),
            self.cascades_dir(),
            self.sloop_dir().join("roles"),
        ] {
            fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}
```

- [ ] **Step 2: Write the scaffold test**

Create `crates/sloop-core/tests/workspace_fs.rs`:
```rust
use sloop_core::workspace::Workspace;
use tempfile::tempdir;

#[test]
fn scaffold_is_idempotent_and_creates_dirs() {
    let tmp = tempdir().unwrap();
    let ws = Workspace::open(tmp.path());

    ws.ensure_scaffold().unwrap();
    ws.ensure_scaffold().unwrap(); // second call must not error

    assert!(ws.databank_dir().is_dir());
    assert!(ws.cascades_dir().is_dir());
    assert!(ws.sloop_dir().join("roles").is_dir());
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p sloop-core --test workspace_fs`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add crates/sloop-core/src/workspace.rs crates/sloop-core/tests/workspace_fs.rs
git commit -m "feat: add Workspace paths and ensure_scaffold"
```

---

### Task 7: Read/write loop files in the workspace

**Files:**
- Modify: `crates/sloop-core/src/workspace.rs`
- Test: `crates/sloop-core/tests/workspace_fs.rs` (append)

- [ ] **Step 1: Add read_loop / write_loop**

Add to the `impl Workspace` block in `crates/sloop-core/src/workspace.rs` (and add the imports shown):
```rust
// add near the top of the file:
use crate::model::LoopDoc;

// add inside `impl Workspace`:
    /// Write a loop to `rel_path` (relative to workspace root), creating parent
    /// dirs as needed. Renders via LoopDoc::to_markdown.
    pub fn write_loop(&self, rel_path: impl AsRef<Path>, doc: &LoopDoc) -> Result<()> {
        let path = self.root.join(rel_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, doc.to_markdown()?)?;
        Ok(())
    }

    /// Read and parse a loop from `rel_path` (relative to workspace root).
    pub fn read_loop(&self, rel_path: impl AsRef<Path>) -> Result<LoopDoc> {
        let path = self.root.join(rel_path);
        let raw = fs::read_to_string(path)?;
        LoopDoc::parse(&raw)
    }
```

- [ ] **Step 2: Write the disk round-trip test**

Append to `crates/sloop-core/tests/workspace_fs.rs`:
```rust
use sloop_core::model::{LoopDoc, LoopFrontmatter, LoopKind, LoopStatus};

#[test]
fn write_then_read_loop_roundtrips_on_disk() {
    let tmp = tempdir().unwrap();
    let ws = Workspace::open(tmp.path());
    ws.ensure_scaffold().unwrap();

    let doc = LoopDoc {
        frontmatter: LoopFrontmatter {
            id: "_architect".into(),
            kind: LoopKind::Architect,
            role: "architect".into(),
            model: "opus".into(),
            status: LoopStatus::AwaitingApproval,
            delta: None,
            parent: None,
            children: vec![],
            source_adr: None,
            acceptance_criteria: vec![],
            executor: None,
        },
        body: "# Decompose\n".into(),
    };

    let rel = "cascades/requirements-sync/_architect.md";
    ws.write_loop(rel, &doc).unwrap();
    let read = ws.read_loop(rel).unwrap();

    assert_eq!(read, doc);
    assert!(tmp.path().join(rel).is_file());
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p sloop-core --test workspace_fs`
Expected: PASS (2 tests now).

- [ ] **Step 4: Commit**

```bash
git add crates/sloop-core/src/workspace.rs crates/sloop-core/tests/workspace_fs.rs
git commit -m "feat: add Workspace read_loop/write_loop"
```

---

### Task 8: Git layer — init + commit_all

**Files:**
- Modify: `crates/sloop-core/src/git.rs`
- Test: `crates/sloop-core/tests/git_commit.rs`

- [ ] **Step 1: Write the GitRepo type**

Replace `crates/sloop-core/src/git.rs`:
```rust
use std::path::Path;

use git2::{Repository, Signature};

use crate::Result;

/// Thin git wrapper over a workspace directory.
pub struct GitRepo {
    repo: Repository,
}

impl GitRepo {
    /// Initialize a new git repository at `root` (or open if one exists).
    pub fn init(root: impl AsRef<Path>) -> Result<Self> {
        let repo = match Repository::open(root.as_ref()) {
            Ok(r) => r,
            Err(_) => Repository::init(root.as_ref())?,
        };
        Ok(GitRepo { repo })
    }

    /// Stage all changes and create a commit. Returns the commit's short id.
    /// Uses a fixed in-repo signature so the crate is environment-agnostic and
    /// does not depend on global git config being present.
    pub fn commit_all(&self, message: &str) -> Result<String> {
        let mut index = self.repo.index()?;
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
        index.write()?;
        let tree_id = index.write_tree()?;
        let tree = self.repo.find_tree(tree_id)?;

        let sig = Signature::now("sloop", "sloop@localhost")?;

        let parent = match self.repo.head() {
            Ok(head) => Some(head.peel_to_commit()?),
            Err(_) => None, // first commit, no parent
        };
        let parents: Vec<&git2::Commit> = parent.iter().collect();

        let oid = self
            .repo
            .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
        Ok(format!("{:.7}", oid))
    }
}
```

- [ ] **Step 2: Write the git integration test**

Create `crates/sloop-core/tests/git_commit.rs`:
```rust
use sloop_core::git::GitRepo;
use std::fs;
use tempfile::tempdir;

#[test]
fn init_then_two_commits_have_distinct_ids() {
    let tmp = tempdir().unwrap();
    let repo = GitRepo::init(tmp.path()).unwrap();

    fs::write(tmp.path().join("a.md"), "first").unwrap();
    let c1 = repo.commit_all("first commit").unwrap();

    fs::write(tmp.path().join("b.md"), "second").unwrap();
    let c2 = repo.commit_all("second commit").unwrap();

    assert_eq!(c1.len(), 7);
    assert_ne!(c1, c2);
    assert!(tmp.path().join(".git").is_dir());
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p sloop-core --test git_commit`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add crates/sloop-core/src/git.rs crates/sloop-core/tests/git_commit.rs
git commit -m "feat: add GitRepo init and commit_all"
```

---

### Task 9: Crate-wide green + docs

**Files:**
- Modify: `crates/sloop-core/src/lib.rs` (add crate-level doc comment)

- [ ] **Step 1: Add a crate doc comment**

Add to the very top of `crates/sloop-core/src/lib.rs`:
```rust
//! `sloop-core`: the markdown-as-persistence foundation for sloop.
//!
//! Models loops and cascades as markdown-with-frontmatter files, reads/writes
//! them in a [`workspace::Workspace`], and tracks changes via [`git::GitRepo`].
//! Diffing, convergence evaluation, and agent execution live in later crates.
```

- [ ] **Step 2: Run the full suite + lints**

Run: `cargo test -p sloop-core && cargo clippy -p sloop-core -- -D warnings`
Expected: all tests PASS; clippy reports no warnings. Fix any clippy findings inline.

- [ ] **Step 3: Commit**

```bash
git add crates/sloop-core/src/lib.rs
git commit -m "docs: add sloop-core crate documentation"
```

---

## Self-Review

**Spec coverage (against §4.2/§4.3 of the design doc — the only sections this plan targets):**
- Markdown-as-persistence (loop files) → Tasks 4, 5, 7. ✓
- Loop frontmatter schema (id, kind, role, model, status, delta, parent, children, source_adr, acceptance_criteria, executor) → Task 5. ✓
- Acceptance criteria with stable IDs + optional `verify` → Task 3. ✓
- Workspace layout (databank/cascades/.sloop) → Task 6. ✓
- Git as history substrate → Task 8. ✓
- Explicitly NOT in this plan (later plans): diff/delta computation, convergence evaluation, executor/agent processes, UI. ✓ (matches the "does NOT" note in the header)

**Placeholder scan:** Placeholder module files in Task 1 are intentional and each is replaced by a named later task; no "TBD/handle edge cases/write tests for the above" remain. ✓

**Type consistency:** `LoopDoc`, `LoopFrontmatter`, `AcceptanceCriterion`, `LoopKind`, `LoopStatus`, `Delta` names and fields are identical across Tasks 2–7. `commit_all`/`init` on `GitRepo` and `read_loop`/`write_loop`/`ensure_scaffold` on `Workspace` are referenced consistently. ✓
