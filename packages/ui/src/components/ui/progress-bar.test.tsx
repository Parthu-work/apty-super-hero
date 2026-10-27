import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
  it("reports how far a determinate job has got", () => {
    render(<ProgressBar value={4} max={20} aria-label="Pages captured" />);
    const bar = screen.getByRole("progressbar", { name: "Pages captured" });
    expect(bar).toHaveAttribute("aria-valuenow", "4");
    expect(bar).toHaveAttribute("aria-valuemax", "20");
  });

  it("never reports more than its maximum", () => {
    render(<ProgressBar value={42} max={38} aria-label="States reached" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "38",
    );
  });

  it("has no value while indeterminate", () => {
    render(<ProgressBar value={null} aria-label="Checking this page" />);
    const bar = screen.getByRole("progressbar", { name: "Checking this page" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("data-state", "indeterminate");
  });
});
