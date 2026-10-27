import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./badge";

function indicator(text: string) {
  const badge = screen.getByText(text).closest("[data-slot=badge]");
  return badge?.querySelector("[data-indicator]");
}

describe("StatusBadge", () => {
  it.each([
    ["neutral", "dot"],
    ["info", "icon"],
    ["success", "icon"],
    ["warning", "icon"],
    ["danger", "icon"],
  ] as const)("shows a %s status with a %s and its word", (tone, kind) => {
    render(<StatusBadge tone={tone}>Status word</StatusBadge>);
    const mark = indicator("Status word");
    expect(mark).toHaveAttribute("data-indicator", kind);
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByText("Status word").closest("[data-slot=badge]"),
    ).toHaveAttribute("data-tone", tone);
  });

  it("shows a spinner for a running job", () => {
    render(
      <StatusBadge tone="info" indicator="spinner">
        Running 4 of 20
      </StatusBadge>,
    );
    expect(indicator("Running 4 of 20")).toHaveAttribute(
      "data-indicator",
      "spinner",
    );
  });

  it("exposes only the word to assistive technology", () => {
    const { container } = render(
      <StatusBadge tone="warning">Needs setup</StatusBadge>,
    );
    expect(container.textContent).toBe("Needs setup");
  });
});
