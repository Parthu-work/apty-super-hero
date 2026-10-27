import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { OptionCard, OptionCardGroup } from "./option-card";

function Scope({ onPick }: { onPick: (value: string) => void }) {
  const [value, setValue] = useState("page");
  const pick = (next: string) => {
    setValue(next);
    onPick(next);
  };
  return (
    <OptionCardGroup aria-label="What to check">
      <OptionCard
        name="scope"
        value="page"
        title="This page"
        description="Checks the page you're on."
        checked={value === "page"}
        onChange={() => pick("page")}
      />
      <OptionCard
        name="scope"
        value="application"
        title="Whole application"
        description="Visits linked pages."
        checked={value === "application"}
        onChange={() => pick("application")}
      />
      <OptionCard
        name="scope"
        value="deep"
        title="Whole application: deep"
        disabled
        checked={value === "deep"}
        onChange={() => pick("deep")}
      />
    </OptionCardGroup>
  );
}

describe("OptionCard", () => {
  it("is a named radio inside a named radio group", () => {
    render(<Scope onPick={vi.fn()} />);
    expect(
      screen.getByRole("radiogroup", { name: "What to check" }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: /^This page/ })).toBeChecked();
  });

  it("selects a card when its text is clicked", () => {
    const onPick = vi.fn();
    render(<Scope onPick={onPick} />);
    fireEvent.click(screen.getByText("Visits linked pages."));
    expect(onPick).toHaveBeenCalledWith("application");
    expect(
      screen.getByRole("radio", { name: /^Whole applicationVisits/ }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: /^This page/ })).not.toBeChecked();
  });

  it("cannot be chosen while disabled", () => {
    const onPick = vi.fn();
    render(<Scope onPick={onPick} />);
    const deep = screen.getByRole("radio", { name: "Whole application: deep" });
    expect(deep).toBeDisabled();
    fireEvent.click(screen.getByText("Whole application: deep"));
    expect(onPick).not.toHaveBeenCalled();
  });
});
