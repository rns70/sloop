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
      doc: sample-workspace/architecture/auth.md
      status: evaluating
      agent: pi
evals:
  - Every authentication requirement has a downstream architecture decision.
---
# Authentication Requirements

Sessions must be covered.
`;

    const doc = parseLoopMarkdown("sample-workspace/PRD.md", raw);

    expect(doc.title).toBe("Authentication Requirements");
    expect(doc.loop.type).toBe("prd");
    expect(doc.loop.autoApply).toBe(true);
    expect(doc.stages).toEqual([
      {
        id: "auth-architecture",
        title: "Auth architecture",
        doc: "sample-workspace/architecture/auth.md",
        status: "evaluating",
        agent: "pi"
      }
    ]);
    expect(doc.evals).toHaveLength(1);
    expect(doc.body).not.toContain("---");

    const serialized = serializeLoopMarkdown(doc.frontmatter, doc.body);
    expect(serialized).toContain("autoApply: true");
    expect(serialized).toContain("# Authentication Requirements");
  });
});
