import type { UIToolPart } from "@apty/ui/types";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelectorAnalysisDisplay } from "./selector-analysis-display";

function tool(output: unknown): UIToolPart {
  return {
    type: "tool",
    toolName: "analyze_element_selectors",
    toolCallId: "call-1",
    input: {},
    output,
    state: "completed",
  };
}

const OUTPUT = {
  available: true,
  tagName: "button",
  inShadowDom: true,
  candidates: [
    {
      selector: "[data-testid='submit']",
      type: "data-attribute",
      staticRisk: "low",
      reasons: ["Uses a test id"],
      verdict: "recommended",
      verdictReason: "Stable and unique",
      live: { matchCount: 1, matchesTarget: true },
    },
    {
      selector: "form > button.btn-17",
      type: "css",
      staticRisk: "medium",
      reasons: [],
      verdict: "risky",
      verdictReason: "Depends on the form's structure",
    },
    {
      selector: "#ember412",
      type: "id",
      staticRisk: "high",
      reasons: [],
      verdict: "broken",
      verdictReason: "Generated id",
      live: { matchCount: 0, matchesTarget: false },
    },
  ],
};

describe("SelectorAnalysisDisplay", () => {
  it("fills the meter by the static risk and says the level in words, never as a number", () => {
    const { container } = render(
      <SelectorAnalysisDisplay tool={tool(OUTPUT)} />,
    );

    const meters = [...container.querySelectorAll("[data-risk]")];
    expect(
      meters.map((meter) => [
        meter.getAttribute("data-risk"),
        meter.querySelectorAll("[data-filled]").length,
      ]),
    ).toEqual([
      ["low", 3],
      ["medium", 2],
      ["high", 1],
    ]);
    expect(meters.map((meter) => meter.textContent)).toEqual([
      "StrongReliability: strong",
      "ModerateReliability: moderate",
      "WeakReliability: weak",
    ]);
    expect(container.textContent).not.toMatch(/\d+\s*%/);
  });

  it("shows the live match count only where a live check ran", () => {
    render(<SelectorAnalysisDisplay tool={tool(OUTPUT)} />);

    expect(
      within(
        screen.getByRole("region", { name: "Recommended selector" }),
      ).getByText("Matches 1 element on the page"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Matches 0 elements on the page"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/^Matches \d/)).toHaveLength(2);
  });

  it("gives each other candidate its verdict and a copy button", () => {
    render(<SelectorAnalysisDisplay tool={tool(OUTPUT)} />);

    expect(screen.getByText("Risky")).toBeInTheDocument();
    expect(screen.getByText("Broken")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy selector #ember412" }),
    ).toBeInTheDocument();
  });

  it("explains a Shadow DOM boundary in a notice", () => {
    render(<SelectorAnalysisDisplay tool={tool(OUTPUT)} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /inside a Shadow DOM subtree/,
    );
  });

  it("says why when the element could not be analyzed", () => {
    render(
      <SelectorAnalysisDisplay
        tool={tool({ available: false, message: "Tab 7 was closed." })}
      />,
    );

    expect(
      screen.getByText("Unable to analyze this element."),
    ).toBeInTheDocument();
    expect(screen.getByText("Tab 7 was closed.")).toBeInTheDocument();
  });
});
