import { describe, expect, it } from "vitest";

// Importing the tool registry barrel transitively loads
// `InterventionManager.getInstance()` at module scope, which wires up
// `chrome.tabs` listeners. Stub just enough of `chrome` for that
// module-level side effect to no-op — this test never drives interventions.
(global as any).chrome = {
  tabs: {
    onActivated: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
  },
  runtime: { onMessage: { addListener: () => {} } },
};

const { allBrowserTools, browserToolGroups } = await import("./index.js");
const { selectRelevantTools } = await import("./tool-relevance.js");

function names(tools: { name: string }[]): string[] {
  return tools.map((t) => t.name).sort();
}

describe("selectRelevantTools", () => {
  it("returns no tools for casual chat", () => {
    expect(selectRelevantTools("hi")).toEqual([]);
    expect(selectRelevantTools("thanks!")).toEqual([]);
    expect(selectRelevantTools("hello")).toEqual([]);
    expect(selectRelevantTools("ok")).toEqual([]);
  });

  it("returns page + selector tools for a DOM/page question", () => {
    const result = selectRelevantTools(
      "what is the DOM structure of this page and can you highlight the submit button element",
    );
    const resultNames = new Set(names(result));
    for (const tool of browserToolGroups.page) {
      expect(resultNames.has(tool.name)).toBe(true);
    }
  });

  it("returns apty + investigation tools for an Apty debugging question", () => {
    const result = selectRelevantTools(
      "the Apty widget tooltip isn't showing up, can you investigate why",
    );
    const resultNames = new Set(names(result));
    for (const tool of browserToolGroups.apty) {
      expect(resultNames.has(tool.name)).toBe(true);
    }
    for (const tool of browserToolGroups.investigation) {
      expect(resultNames.has(tool.name)).toBe(true);
    }
  });

  it("returns network/devtools tools for a network debugging question", () => {
    const result = selectRelevantTools(
      "why is this network request failing, check the console error too",
    );
    const resultNames = new Set(names(result));
    for (const tool of browserToolGroups.devtools) {
      expect(resultNames.has(tool.name)).toBe(true);
    }
    for (const tool of browserToolGroups.networkCapture) {
      expect(resultNames.has(tool.name)).toBe(true);
    }
  });

  it("returns extension-network tools for an Apty Client resource request, generically for any resource name", () => {
    for (const message of [
      "get segments.json",
      "get app.json",
      "get flow.json",
      "what resources did Apty Client load?",
    ]) {
      const result = selectRelevantTools(message);
      const resultNames = new Set(names(result));
      for (const tool of browserToolGroups.extensionNetwork) {
        expect(resultNames.has(tool.name)).toBe(true);
      }
    }
  });

  it("falls back to a minimal grounding set for an ambiguous non-casual message", () => {
    const result = selectRelevantTools(
      "can you help me understand what is happening right now",
    );
    expect(result.length).toBeGreaterThan(0);
    const resultNames = new Set(names(result));
    for (const tool of browserToolGroups.tabs) {
      expect(resultNames.has(tool.name)).toBe(true);
    }
  });

  it("never returns duplicate tools across overlapping categories", () => {
    const result = selectRelevantTools(
      "investigate why the Apty widget's network requests are failing and check devtools",
    );
    const resultNames = names(result);
    expect(new Set(resultNames).size).toBe(resultNames.length);
  });

  it("only ever returns tools that exist in the full registry", () => {
    const allNames = new Set(names(allBrowserTools));
    const result = selectRelevantTools(
      "get segments.json from Apty Client and investigate the widget",
    );
    for (const tool of result) {
      expect(allNames.has(tool.name)).toBe(true);
    }
  });
});
