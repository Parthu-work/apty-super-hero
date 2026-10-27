import type { InvestigationPlan } from "@apty/browser-runtime";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanChecklist } from "./plan-checklist";

const PLAN: InvestigationPlan = {
  category: "widget-not-loading",
  steps: [
    {
      id: "s1",
      description: "Check the Apty Client",
      suggestedTools: [],
      status: "done",
    },
    {
      id: "s2",
      description: "Check Studio",
      suggestedTools: [],
      status: "skipped",
    },
    {
      id: "s3",
      description: "Read the page logs",
      suggestedTools: [],
      status: "pending",
    },
  ],
};

describe("PlanChecklist", () => {
  it("counts only the steps really done, with no progress bar", () => {
    render(<PlanChecklist plan={PLAN} />);

    expect(screen.getByText("1 of 3 steps done")).toBeInTheDocument();
    expect(screen.getByText("Widget not loading")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("names each step's state for screen readers, and numbers the pending one by its place", () => {
    render(<PlanChecklist plan={PLAN} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Check the Apty Client, done",
      "Check Studio, skipped",
      "3Read the page logs, pending",
    ]);
  });

  it("shows an unknown category as recorded", () => {
    render(<PlanChecklist plan={{ ...PLAN, category: "custom-pattern" }} />);

    expect(screen.getByText("custom-pattern")).toBeInTheDocument();
  });
});
