import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequestLimitsCard } from "./request-limits-card";

function renderCard(settings = {}) {
  const onChange = vi.fn();
  render(<RequestLimitsCard settings={settings} onChange={onChange} />);
  return {
    onChange,
    budget: screen.getByLabelText("Request budget (tokens)"),
    cap: screen.getByLabelText("Answer length cap (tokens)"),
  };
}

describe("RequestLimitsCard", () => {
  it("shows the saved limits, and no limit when none is saved", () => {
    const { budget, cap } = renderCard({ requestTokenBudget: 6_000 });

    expect(budget).toHaveValue("6000");
    expect(cap).toHaveValue("");
    expect(cap).toHaveAttribute("placeholder", "No limit");
  });

  it("saves a whole number when the field is left, and on Enter", () => {
    const { onChange, budget, cap } = renderCard();

    fireEvent.change(budget, { target: { value: "6,000" } });
    fireEvent.blur(budget);
    fireEvent.change(cap, { target: { value: "1024" } });
    fireEvent.keyDown(cap, { key: "Enter" });

    expect(onChange.mock.calls).toEqual([
      [{ requestTokenBudget: 6_000 }],
      [{ maxOutputTokens: 1_024 }],
    ]);
  });

  it("clears a limit when the field is emptied", () => {
    const { onChange, budget } = renderCard({ requestTokenBudget: 6_000 });

    fireEvent.change(budget, { target: { value: "" } });
    fireEvent.blur(budget);

    expect(onChange).toHaveBeenCalledWith({ requestTokenBudget: undefined });
  });

  it("names the accepted range and saves nothing for a value outside it", () => {
    const { onChange, budget } = renderCard();

    fireEvent.change(budget, { target: { value: "1500" } });
    fireEvent.blur(budget);

    expect(onChange).not.toHaveBeenCalled();
    expect(budget).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(
        "Enter a whole number from 2,000 to 2,000,000, or leave it empty.",
      ),
    ).toBeInTheDocument();
  });

  it("does not save a value that did not change", () => {
    const { onChange, cap } = renderCard({ maxOutputTokens: 800 });

    fireEvent.blur(cap);

    expect(onChange).not.toHaveBeenCalled();
  });
});
