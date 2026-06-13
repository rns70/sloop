import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FrontmatterPanel, updateLoopFrontmatter } from "../src/components/FrontmatterPanel";
import type { LoopDoc } from "../src/shared/types";

const doc: LoopDoc = {
  path: "loops/PRD.md",
  title: "Authentication Requirements",
  frontmatter: {
    loop: {
      id: "prd-auth",
      type: "prd",
      status: "running",
      autoApply: true,
      stages: [
        {
          id: "auth-architecture",
          kind: "doc",
          title: "Auth architecture",
          doc: "loops/architecture/auth.md",
          status: "idle",
          agent: "pi"
        }
      ]
    },
    evals: ["Every authentication requirement has a downstream architecture decision."]
  },
  loop: {
    id: "prd-auth",
    type: "prd",
    status: "running",
    autoApply: true,
    stages: [
      {
        id: "auth-architecture",
        title: "Auth architecture",
        doc: "loops/architecture/auth.md",
        status: "idle",
        agent: "pi"
      }
    ]
  },
  stages: [
    {
      id: "auth-architecture",
      title: "Auth architecture",
      doc: "loops/architecture/auth.md",
      status: "idle",
      agent: "pi"
    }
  ],
  evals: [
    {
      id: "eval-1",
      text: "Every authentication requirement has a downstream architecture decision.",
      status: "pending"
    }
  ],
  body: "# Authentication Requirements\n\nSessions must be covered.\n",
  raw: ""
};

describe("frontmatter panel", () => {
  it("renders loop frontmatter as document-native controls", () => {
    const markup = renderToStaticMarkup(
      <FrontmatterPanel
        doc={doc}
        draftFrontmatter={doc.frontmatter}
        dirty={false}
        saving={false}
        onChange={() => undefined}
        onSave={() => undefined}
      />
    );

    expect(markup).toContain("Loop metadata");
    expect(markup).toContain('name="loop-id"');
    expect(markup).toContain('value="prd-auth"');
    expect(markup).toContain('name="loop-type"');
    expect(markup).toContain('value="prd"');
    expect(markup).toContain('name="loop-auto-apply"');
    expect(markup).toContain("Auth architecture");
    expect(markup).toContain("Every authentication requirement has a downstream architecture decision.");
    expect(markup).not.toContain("---");
  });

  it("updates loop frontmatter without dropping sibling metadata", () => {
    const next = updateLoopFrontmatter(doc.frontmatter, "status", "paused");

    expect(next).toEqual({
      ...doc.frontmatter,
      loop: {
        ...(doc.frontmatter.loop as Record<string, unknown>),
        status: "paused"
      }
    });
  });
});
