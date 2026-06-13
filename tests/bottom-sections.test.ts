import { describe, expect, it } from "vitest";
import {
  bottomSectionsReducer,
  createClosedBottomSections
} from "../src/lib/bottomSections.js";

describe("bottom section disclosure state", () => {
  it("toggles graph and console independently", () => {
    const closed = createClosedBottomSections();
    const graphOpen = bottomSectionsReducer(closed, { type: "toggle", section: "graph" });
    const bothOpen = bottomSectionsReducer(graphOpen, { type: "toggle", section: "console" });
    const graphClosed = bottomSectionsReducer(bothOpen, { type: "toggle", section: "graph" });

    expect(graphOpen).toEqual({ graph: true, console: false });
    expect(bothOpen).toEqual({ graph: true, console: true });
    expect(graphClosed).toEqual({ graph: false, console: true });
  });

  it("keeps open sections open when a document is opened", () => {
    const openSections = { graph: true, console: true };

    expect(bottomSectionsReducer(openSections, { type: "openDoc" })).toEqual(openSections);
  });
});
