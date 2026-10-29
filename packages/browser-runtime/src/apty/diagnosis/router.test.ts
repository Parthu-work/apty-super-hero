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
    "why isn't my Apty widget showing",
    "the workflow stops at step 3",
    "explain why a tooltip is hidden",
  ];
  for (const message of leftToTheModel) {
    it(`leaves "${message}" to the model`, () => {
      expect(routeSymptom(message)).toBeUndefined();
    });
  }

  it("does not read an apostrophe as the start of a name", () => {
    expect(
      routeSymptom("the user's workflow isn't showing in the widget")?.query,
    ).toBeUndefined();
  });
});
