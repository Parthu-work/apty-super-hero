import { describe, expect, it } from "vitest";
import { routeSymptom } from "./router";

describe("routeSymptom", () => {
  const routed: Array<[string, string, string | undefined]> = [
    ["My workflow is not visible in the widget", "workflow", undefined],
    ["my workflow isn't showing in the widget list", "workflow", undefined],
    [
      "My workflow 'Take a tour' is not visible in the widget",
      "workflow",
      "Take a tour",
    ],
    [
      'Tooltip "Lead source help" does not appear',
      "tooltip",
      "Lead source help",
    ],
    [
      "The launcher called Start: Create a lead isn't showing for my users",
      "launcher",
      "Start: Create a lead",
    ],
    [
      "the Create a lead workflow is missing from the widget",
      "workflow",
      "Create a lead",
    ],
    [
      "workflow Request a quote is not visible for sales users",
      "workflow",
      "Request a quote",
    ],
    ["announcement is missing in production", "announcement", undefined],
    [
      "users can't see the validation on the email field",
      "validation",
      undefined,
    ],
    ["the learning path disappeared from the widget", "checklist", undefined],
    [
      "help library item is not showing in the widget",
      "knowledgeContent",
      undefined,
    ],
  ];
  for (const [message, kind, query] of routed) {
    it(`routes "${message}"`, () => {
      expect(routeSymptom(message)).toEqual({
        packId: "content-not-visible",
        kind,
        ...(query ? { query } : {}),
      });
    });
  }

  const leftToTheModel = [
    "How do I configure a workflow?",
    "what is a segment",
    "hi",
    "get segments.json",
    "the workflow stops at step 3",
    "explain why a tooltip is hidden",
    "how do I change the widget's colour?",
    "the widget is too big on my screen",
    "the widget opens slowly",
  ];
  for (const message of leftToTheModel) {
    it(`leaves "${message}" to the model`, () => {
      expect(routeSymptom(message)).toBeUndefined();
    });
  }

  const widget = [
    "why isn't my Apty widget showing",
    "The Apty widget is not appearing on the application",
    "widget is missing for every user",
    "the widget works in Test but not in Production",
    "Apty works in UAT but not in prod",
    "content only works on one page",
    "it shows on the main page but not on the others",
  ];
  for (const message of widget) {
    it(`routes "${message}" to the widget check`, () => {
      expect(routeSymptom(message)).toEqual({ packId: "widget-not-visible" });
    });
  }

  it("keeps a message naming a content kind on the content check", () => {
    expect(
      routeSymptom("my workflow is not showing in the widget")?.packId,
    ).toBe("content-not-visible");
  });

  it("reads the language a message names, as its code", () => {
    for (const [message, language] of [
      ["the Create a lead workflow is not showing for French users", "fr"],
      ["workflow 'Take a tour' is missing in German", "de"],
      ["my announcement isn't visible to spanish-speaking users", "es"],
    ]) {
      expect(routeSymptom(message as string)).toMatchObject({
        packId: "content-not-visible",
        language,
      });
    }
    expect(
      routeSymptom("my workflow is not visible in the widget"),
    ).not.toHaveProperty("language");
  });

  const logs: Array<[string, boolean]> = [
    ["the console says No active application found", false],
    ["I see Error registering IoC in the logs", false],
    ["is a CSP rule blocking Apty?", false],
    ["the widget fails with a CORS error", false],
    [
      "my workflow doesn't load and the console shows Error parsing response",
      false,
    ],
    ["check the apty client logs", false],
    ["any errors in the console?", false],
    ["show me the failed requests", false],
    ["is Apty causing the 404 errors in our app?", true],
    ["we get 404s since Apty was installed", true],
  ];
  for (const [message, about404] of logs) {
    it(`routes "${message}" to the logs check`, () => {
      expect(routeSymptom(message)).toEqual({
        packId: "logs-and-errors",
        ...(about404 ? { about404 } : {}),
      });
    });
  }

  it("keeps a content or widget question ahead of a passing mention of errors", () => {
    expect(
      routeSymptom("my workflow is not visible in the widget")?.packId,
    ).toBe("content-not-visible");
    expect(routeSymptom("the widget is not showing")?.packId).toBe(
      "widget-not-visible",
    );
    for (const message of [
      "how do I read the service worker logs?",
      "run a console command and check the network request",
      "what is a CSP?",
      "investigate why the apty widget doesn't load: check the console error and the network request",
    ]) {
      expect(routeSymptom(message)).toBeUndefined();
    }
  });

  const selector: Array<[string, Record<string, unknown>]> = [
    [
      "Apty cannot find the element for the 'Lead source help' tooltip",
      { kind: "tooltip", query: "Lead source help" },
    ],
    [
      "the Save tooltip is on the wrong element",
      { kind: "tooltip", query: "Save" },
    ],
    [
      "the selector is green in Studio but the launcher does not appear",
      { kind: "launcher" },
    ],
    [
      "workflow 'Take a tour' step 2 fails, the element is not identified",
      { kind: "workflow", query: "Take a tour", step: 2 },
    ],
    [
      "the Email format validation's selector stopped working",
      { kind: "validation", query: "Email format" },
    ],
    ["my tooltip is missing after a page reload", { kind: "tooltip" }],
    [
      "the Take a tour  at step 2 workflow fails",
      { kind: "workflow", query: "Take a tour", step: 2 },
    ],
  ];
  for (const [message, expected] of selector) {
    it(`routes "${message}" to the selector check`, () => {
      expect(routeSymptom(message)).toEqual({
        packId: "element-not-found",
        ...expected,
      });
    });
  }

  it("routes a page where nothing can be selected to the page check, and keeps DOM Health requests with the model", () => {
    for (const message of [
      "Apty cannot select any elements on this page",
      "the element picker does not work here",
      "only the header and footer can be selected",
      "is this page Apty-ready?",
    ]) {
      expect(routeSymptom(message)).toEqual({ packId: "page-readiness" });
    }
    for (const message of [
      "check DOM health",
      "run a DOM health audit of this page",
      "how do I use the element picker?",
      "select the Save button",
    ]) {
      expect(routeSymptom(message)).toBeUndefined();
    }
  });

  it("keeps a visibility question on the content check when it does not say the element is not found", () => {
    expect(routeSymptom("the Save tooltip is not showing")?.packId).toBe(
      "content-not-visible",
    );
    expect(routeSymptom("the tooltip fails with a CSP error")?.packId).toBe(
      "logs-and-errors",
    );
  });

  it("keeps a stray quote mark out of a name", () => {
    expect(
      routeSymptom('the workflow called Take a tour" is not visible')?.query,
    ).toBe("Take a tour");
  });

  it("does not read an apostrophe as the start of a name", () => {
    expect(
      routeSymptom("the user's workflow isn't showing in the widget")?.query,
    ).toBeUndefined();
  });

  it("names the item nearest its kind, not the words after an earlier 'the' (N1)", () => {
    expect(
      routeSymptom("The selector for the Save tooltip is not working"),
    ).toEqual({ packId: "element-not-found", kind: "tooltip", query: "Save" });
  });

  it("reads 'missing', 'hidden' and 'gone' as not visible only when nothing follows them as an object (2)", () => {
    for (const message of [
      "the workflow is missing a step",
      "the tooltip has a hidden field",
      "the launcher has gone through review",
    ]) {
      expect(routeSymptom(message)).toBeUndefined();
    }
    expect(routeSymptom("the onboarding flow is gone")).toEqual({
      packId: "content-not-visible",
      kind: "workflow",
      query: "onboarding",
    });
  });

  it("leaves a request to investigate to the model (2)", () => {
    for (const message of [
      "Investigate why the onboarding workflow is hidden from the widget",
      "investigate the tooltip that is not showing",
      "please investigate why the Save tooltip selector stopped working",
    ]) {
      expect(routeSymptom(message)).toBeUndefined();
    }
  });

  it("leaves how-to and ordinary messages to the model (N6)", () => {
    for (const message of [
      "How would I make a validation green in Studio?",
      "should a launcher be on the wrong element?",
      "write a workflow step that fails gracefully",
      "is this page ready for the demo?",
      "I can't select anything in this dropdown",
    ]) {
      expect(routeSymptom(message)).toBeUndefined();
    }
    expect(routeSymptom("I can't select any elements in Studio")).toEqual({
      packId: "page-readiness",
    });
  });

  it("routes a widget that does not load, and an item that fails at a step (16)", () => {
    for (const message of [
      "the widget doesn't load",
      "the widget isn't loading on the CRM",
    ]) {
      expect(routeSymptom(message)).toEqual({ packId: "widget-not-visible" });
    }
    expect(routeSymptom("the onboarding workflow fails at step 3")).toEqual({
      packId: "element-not-found",
      kind: "workflow",
      query: "onboarding",
      step: 3,
    });
    expect(routeSymptom("Create a lead fails at step 2")).toEqual({
      packId: "element-not-found",
      kind: "workflow",
      query: "Create a lead",
      step: 2,
    });
    expect(routeSymptom("the workflow fails at step 4")).toEqual({
      packId: "element-not-found",
      kind: "workflow",
      step: 4,
    });
  });

  it("routes a widget that is not showing, asked in Chinese (6)", () => {
    for (const message of [
      "为什么我的 Apty Widget 没有显示？",
      "小组件没有出现",
      "Apty 小组件不显示",
    ]) {
      expect(routeSymptom(message)).toEqual({ packId: "widget-not-visible" });
    }
    expect(routeSymptom("为什么这个工作流停止了？")).toBeUndefined();
  });
});
