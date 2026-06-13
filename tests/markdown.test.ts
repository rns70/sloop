import { describe, expect, it } from "vitest";
import { parseLoopMarkdown, serializeLoopMarkdown } from "../server/lib/markdown.js";

describe("loop markdown parser", () => {
  it("keeps frontmatter separate and extracts inline child stages", () => {
    const raw = `---
loop:
  id: prd-auth
  type: prd
  status: passing
  autoApply: true
  stages:
    - id: auth-architecture
      title: Auth architecture
      doc: loops/architecture/auth.md
      status: evaluating
      agent: pi
evals:
  - Every authentication requirement has a downstream architecture decision.
---
# Authentication Requirements

Sessions must be covered.
`;

    const doc = parseLoopMarkdown("loops/PRD.md", raw);

    expect(doc.title).toBe("Authentication Requirements");
    expect(doc.loop.type).toBe("prd");
    expect(doc.loop.autoApply).toBe(true);
    expect(doc.stages).toEqual([
      {
        id: "auth-architecture",
        kind: "doc",
        title: "Auth architecture",
        doc: "loops/architecture/auth.md",
        status: "evaluating",
        agent: "pi",
        outputs: [],
        evals: [],
        commands: []
      }
    ]);
    expect(doc.evals).toHaveLength(1);
    expect(doc.body).not.toContain("---");

    const serialized = serializeLoopMarkdown(doc.frontmatter, doc.body);
    expect(serialized).toContain("autoApply: true");
    expect(serialized).toContain("# Authentication Requirements");
  });

  it("normalizes code stage shorthand and controller metadata", () => {
    const raw = `---
loop:
  id: auth-plan
  type: implementation-plan
  status: running
  autoApply: true
  stages:
    - id: build-auth-session
      kind: code
      title: Build auth session
      status: idle
      outputs:
        - src/auth/**
        - tests/auth/**
      evals:
        - Code covers session expiry.
      eval:
        commands:
          - npm test -- auth
outputs:
  - src/auth/**
commands:
  - npm run typecheck
evals:
  - Implementation plan traces to architecture.
---
# Auth Session Plan

Build the auth session feature.
`;

    const doc = parseLoopMarkdown("loops/plans/auth-session.md", raw);

    expect(doc.outputs).toEqual(["src/auth/**"]);
    expect(doc.commands).toEqual(["npm run typecheck"]);
    expect(doc.stages).toEqual([
      {
        id: "build-auth-session",
        kind: "code",
        title: "Build auth session",
        doc: "loops/build/build-auth-session.md",
        status: "idle",
        agent: undefined,
        outputs: ["src/auth/**", "tests/auth/**"],
        evals: [
          {
            id: "eval-1",
            text: "Code covers session expiry.",
            status: "pending"
          }
        ],
        commands: ["npm test -- auth"]
      }
    ]);
  });
});
