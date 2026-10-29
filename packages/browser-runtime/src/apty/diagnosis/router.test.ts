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

  it("does not read an apostrophe as the start of a name", () => {
    expect(
      routeSymptom("the user's workflow isn't showing in the widget")?.query,
    ).toBeUndefined();
  });
});
