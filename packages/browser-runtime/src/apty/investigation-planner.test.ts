import { describe, expect, it } from "vitest";
import { planInvestigation } from "./investigation-planner";

describe("planInvestigation", () => {
  it("matches the tooltip-not-showing pattern", () => {
    const plan = planInvestigation(
      "The tooltip isn't showing on the Accounts page",
    );

    expect(plan.category).toBe("tooltip-not-showing");
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
    expect(plan.steps.map((s) => s.id)).toContain("analyze-selector");
  });

  it("matches the studio-cannot-select pattern", () => {
    const plan = planInvestigation("Studio can't select this element");

    expect(plan.category).toBe("studio-cannot-select");
    expect(plan.steps.map((s) => s.id)).toContain("check-frame-boundaries");
  });

  it("matches the studio-vs-production pattern", () => {
    const plan = planInvestigation(
      "It works in Studio but doesn't work in production",
    );

    expect(plan.category).toBe("studio-vs-production");
    expect(plan.steps.map((s) => s.id)).toContain("compare");
  });

  it("matches the workflow-not-triggering pattern", () => {
    const plan = planInvestigation("The workflow isn't triggering on click");

    expect(plan.category).toBe("workflow-not-triggering");
    expect(plan.steps.map((s) => s.id)).toContain("check-display-conditions");
  });

  it("matches the widget-not-loading pattern", () => {
    const plan = planInvestigation("The widget isn't loading, page is blank");

    expect(plan.category).toBe("widget-not-loading");
    expect(plan.steps.map((s) => s.id)).toContain("check-widget-status");
  });

  it("falls back to a generic plan for an unrecognized problem", () => {
    const plan = planInvestigation("Something weird is happening on this page");

    expect(plan.category).toBe("generic");
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.map((s) => s.id)).toContain("correlate");
  });

  it("is case-insensitive", () => {
    const plan = planInvestigation("TOOLTIP IS NOT SHOWING");
    expect(plan.category).toBe("tooltip-not-showing");
  });

  it("every step has a non-empty description and at least one suggested tool", () => {
    for (const problem of [
      "tooltip not showing",
      "studio can't select this",
      "works in studio but not production",
      "workflow isn't triggering",
      "widget won't load",
      "unrecognized problem",
    ]) {
      const plan = planInvestigation(problem);
      for (const step of plan.steps) {
        expect(step.description.length).toBeGreaterThan(0);
        expect(step.suggestedTools.length).toBeGreaterThan(0);
      }
    }
  });
});
