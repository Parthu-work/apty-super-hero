import type { AppSettings } from "@apty/agent-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataHandlingCard } from "./data-handling-card";
import { ScreenshotPolicyControl } from "./screenshot-policy-control";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ScreenshotPolicyControl", () => {
  it("offers ask, allow and never, and says what each does", () => {
    render(<ScreenshotPolicyControl policy="ask" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Ask each time (recommended)")).toBeChecked();
    expect(screen.getByLabelText("Always allow")).not.toBeChecked();
    expect(screen.getByLabelText("Never")).not.toBeChecked();
    expect(screen.getByLabelText("Never")).toHaveAccessibleDescription(
      /never sent/i,
    );
  });

  it("reports the chosen policy", () => {
    const onChange = vi.fn();
    render(<ScreenshotPolicyControl policy="ask" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Never"));
    expect(onChange).toHaveBeenCalledWith("never");
  });
});

describe("DataHandlingCard screenshots", () => {
  it("shows ask for settings saved before the option existed, and saves a change", () => {
    const onChange = vi.fn();
    render(
      <DataHandlingCard settings={{} as AppSettings} onChange={onChange} />,
    );
    expect(screen.getByLabelText("Ask each time (recommended)")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Always allow"));
    expect(onChange).toHaveBeenCalledWith({ screenshotPolicy: "allow" });
  });
});
