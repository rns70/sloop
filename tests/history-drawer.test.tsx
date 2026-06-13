import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryPanel } from "../src/components/HistoryPanel";
import type { FileDiff, HistoryEntry } from "../src/shared/types";

const history: HistoryEntry[] = [
  {
    id: "run-1",
    kind: "cascade",
    title: "Cascade run",
    createdAt: "2026-06-13T12:00:00.000Z",
    changedFiles: ["loops/PRD.md"],
    status: "passed",
    summary: "Updated downstream docs"
  }
];

const selectedDiff: FileDiff = {
  path: "loops/PRD.md",
  lines: [
    { type: "remove", text: "Session expiry TBD" },
    { type: "add", text: "Sessions expire after 30 days" }
  ]
};

describe("history panel", () => {
  it("hides the drawer and selected diff until history is selected", () => {
    const markup = renderToStaticMarkup(
      <HistoryPanel
        history={history}
        selectedDiff={selectedDiff}
        open={false}
        onClose={() => undefined}
        onToggle={() => undefined}
      />
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("history-drawer");
    expect(markup).not.toContain("Inline diff");
    expect(markup).not.toContain("Sessions expire after 30 days");
  });

  it("renders history as a right drawer with the selected diff when open", () => {
    const markup = renderToStaticMarkup(
      <HistoryPanel
        history={history}
        selectedDiff={selectedDiff}
        open={true}
        onClose={() => undefined}
        onToggle={() => undefined}
      />
    );

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="History drawer"');
    expect(markup).toContain("history-drawer");
    expect(markup).toContain("Inline diff");
    expect(markup).toContain("Sessions expire after 30 days");
    expect(markup).toContain("Updated downstream docs");
  });
});
