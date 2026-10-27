import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreRing } from "./score-ring";

describe("ScoreRing", () => {
  it("shows the rounded score with its caption, named for screen readers", () => {
    render(
      <ScoreRing
        state="value"
        value={60.6}
        tone="warning"
        label="Score 61 out of 100"
        caption="out of 100"
      />,
    );
    const ring = screen.getByRole("img", { name: "Score 61 out of 100" });
    expect(ring).toHaveTextContent("61out of 100");
  });

  it("keeps the score between 0 and 100", () => {
    render(<ScoreRing state="value" value={140} label="Score" />);
    expect(screen.getByRole("img", { name: "Score" })).toHaveTextContent("100");
  });

  it.each([
    "empty",
    "running",
  ] as const)("shows no number while %s", (state) => {
    render(<ScoreRing state={state} value={61} label="Not checked yet" />);
    const ring = screen.getByRole("img", { name: "Not checked yet" });
    expect(ring).toHaveAttribute("data-state", state);
    expect(ring.textContent).toBe("");
  });
});
