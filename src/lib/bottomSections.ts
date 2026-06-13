export type BottomSection = "graph" | "console";

export type BottomSectionsState = Record<BottomSection, boolean>;

export type BottomSectionsAction =
  | { type: "toggle"; section: BottomSection }
  | { type: "openDoc" };

export function createClosedBottomSections(): BottomSectionsState {
  return {
    graph: false,
    console: false
  };
}

export function bottomSectionsReducer(
  state: BottomSectionsState,
  action: BottomSectionsAction
): BottomSectionsState {
  if (action.type === "openDoc") {
    return state;
  }

  return {
    ...state,
    [action.section]: !state[action.section]
  };
}
