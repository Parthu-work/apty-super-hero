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
const { createStickyToolSelector, selectRelevantTools } = await import(
  "./tool-relevance.js"
);

function names(tools: { name: string }[]): string[] {
  return tools.map((t) => t.name).sort();
}

describe("selectRelevantTools", () => {
  it("never offers the model a tool that can approve a risky action", () => {
    for (const tool of allBrowserTools) {
      expect(tool.name).not.toBe("confirm_risky_action");
      expect(JSON.stringify(tool)).not.toMatch(/userConfirmed|approvalId/);
    }
  });

  it("returns no tools for casual chat", () => {
    for (const message of ["hi", "thanks!", "hello", "ok"]) {
      expect(selectRelevantTools(message)).toEqual([]);
    }
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

  it("offers no investigation tools for a request that only fetches a file", () => {
    const investigationNames = new Set(
      names(browserToolGroups.investigation as { name: string }[]),
    );
    for (const message of [
      "get config.json",
      "Please show segments.json from the Apty Client",
      "can you read app.json",
    ]) {
      const offered = names(selectRelevantTools(message));
      expect(offered.filter((n) => investigationNames.has(n))).toEqual([]);
    }

    const debugging = names(
      selectRelevantTools("get config.json and investigate why it fails"),
    );
    expect(debugging.some((n) => investigationNames.has(n))).toBe(true);
    const question = names(selectRelevantTools("why is segments.json empty"));
    expect(question.some((n) => investigationNames.has(n))).toBe(true);
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

describe("tool order", () => {
  it("is the registry's, however the groups were matched, so equal sets send equal schemas", () => {
    const implied = selectRelevantTools("check the apty client service worker");
    const keyword = selectRelevantTools(
      "investigate the apty client service worker",
    );

    expect(names(implied)).toEqual(names(keyword));
    expect(implied.map((t) => t.name)).toEqual(keyword.map((t) => t.name));
  });
});

describe("createStickyToolSelector", () => {
  const investigation = "investigate why the apty widget is broken here";

  it("keeps the chat's earlier tools for a short follow-up such as 'ok go ahead'", () => {
    const select = createStickyToolSelector();

    const first = select(investigation, "s-1");
    const followUp = select("ok go ahead", "s-1");

    expect(selectRelevantTools("ok go ahead")).toEqual([]);
    expect(names(followUp)).toEqual(names(first));
  });

  it("adds the current message's tools to the remembered ones", () => {
    const select = createStickyToolSelector();
    select(investigation, "s-1");

    const both = names(select("now take a screenshot", "s-1"));

    expect(both).toEqual(
      expect.arrayContaining(["capture_screenshot", "start_investigation"]),
    );
  });

  it("remembers only the last three tool-using turns", () => {
    const select = createStickyToolSelector();
    select(investigation, "s-1");
    select("take a screenshot", "s-1");
    select("switch to the other tab", "s-1");
    select("highlight the save button", "s-1");

    const followUp = names(select("ok", "s-1"));

    expect(followUp).not.toContain("start_investigation");
    expect(followUp).toEqual(
      expect.arrayContaining(["capture_screenshot", "switch_to_tab"]),
    );
  });

  it("keeps each chat's memory apart, and has none without a session", () => {
    const select = createStickyToolSelector();
    select(investigation, "s-1");

    expect(select("ok go ahead", "s-2")).toEqual([]);
    expect(select("ok go ahead", null)).toEqual([]);
    select(investigation, null);
    expect(select("ok go ahead", null)).toEqual([]);
  });

  it("forgets the oldest chat once it holds the most it keeps", () => {
    const select = createStickyToolSelector({ maxSessions: 2 });
    select(investigation, "s-1");
    select(investigation, "s-2");
    select(investigation, "s-3");

    expect(select("ok", "s-1")).toEqual([]);
    expect(select("ok", "s-3").length).toBeGreaterThan(0);
  });
});

describe("run_diagnosis for selector and page questions (N8)", () => {
  it("is offered when a message says an element is not found, a selector broke or nothing can be selected", () => {
    for (const message of [
      "investigate why the Save tooltip selector stopped working",
      "Apty cannot find the element for the Save tooltip",
      "investigate why Apty cannot select any elements on this page",
      "the workflow fails at step 3, investigate",
    ]) {
      expect(names(selectRelevantTools(message))).toContain("run_diagnosis");
    }
  });
});

describe("a file request after an investigation (P1-1)", () => {
  it("gets the file tools only, not the investigation it follows", () => {
    const select = createStickyToolSelector();
    select("investigate why the apty widget is broken here", "s-1");

    const fetch = names(select("get the data from segments.json", "s-1"));

    expect(fetch).toEqual(
      names(selectRelevantTools("get the data from segments.json")),
    );
    expect(fetch).not.toContain("start_investigation");
  });
});
