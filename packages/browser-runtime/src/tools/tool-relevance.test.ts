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
const { createStickyToolSelector, selectRelevantTools, withoutKbSearch } =
  await import("./tool-relevance.js");

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

describe("run_diagnosis for Ask Dapty questions", () => {
  it("is offered when a message is about the Widget's AI assistant", () => {
    for (const message of [
      "Ask Dapty suggested a workflow that does not exist",
      "why did dapty answer with the wrong article",
      "the AI assistant in the widget gives no sources",
      "the ai chat shows an error after my question",
      "check the widget chat for this user",
      "the chatbot recommends a deleted flow",
      "为什么助手推荐的流程打不开",
    ]) {
      expect(names(selectRelevantTools(message))).toContain("run_diagnosis");
    }
  });

  it("is not offered for a chat about something else", () => {
    expect(
      names(selectRelevantTools("please summarize the chat history above")),
    ).not.toContain("run_diagnosis");
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

describe("search_kb (KB-RAG K4)", () => {
  it("is offered with a check pack's symptom and a product follow-up", () => {
    for (const message of [
      "the widget is not showing for this user",
      "the workflow is not showing in the widget",
      "how do I turn that off in Studio?",
      "which setting in Admin hides it",
      "what should I send support",
    ]) {
      expect(names(selectRelevantTools(message))).toContain("search_kb");
    }
  });

  it("is not offered for casual chat or a page task with no Apty symptom", () => {
    for (const message of [
      "hi",
      "click the login button",
      "check dom health",
      "get the data from segments.json",
    ]) {
      expect(names(selectRelevantTools(message))).not.toContain("search_kb");
    }
  });

  it("is offered for any Apty question or symptom, a file's meaning and a question in another script (K16)", () => {
    for (const message of [
      "the tooltip flickers on the page",
      "the page freezes after I click save",
      "what does flow.json mean",
      "segments.json returned 403, what does that mean",
      "which selector does the launcher use",
      "小部件没有显示出来",
    ]) {
      expect(names(selectRelevantTools(message)), message).toContain(
        "search_kb",
      );
    }
  });

  it("is not offered for a bare how-to or a request to fetch a file (D-KB1)", () => {
    for (const message of [
      "how do I configure a launcher for my app",
      "how to create a workflow in this application",
      "give me segments.json",
    ]) {
      expect(names(selectRelevantTools(message)), message).not.toContain(
        "search_kb",
      );
    }
  });

  it("stays offered for a short follow-up to a check", () => {
    const select = createStickyToolSelector();
    select("the workflow is not showing in the widget", "s-kb");
    expect(names(select("ok, and then?", "s-kb"))).toContain("search_kb");
  });
});

describe("withoutKbSearch (KB-RAG K22)", () => {
  it("drops search_kb and keeps every other tool", () => {
    const tools = selectRelevantTools(
      "the Apty widget does not show on this page",
    );
    expect(tools.map((t) => t.name)).toContain("search_kb");
    const without = withoutKbSearch(tools);
    expect(without.map((t) => t.name)).not.toContain("search_kb");
    expect(without).toHaveLength(tools.length - 1);
  });
});
