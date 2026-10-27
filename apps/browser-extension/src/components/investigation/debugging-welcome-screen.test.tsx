import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigationStore } from "../../state/navigation-store";
import { DebuggingWelcomeScreen } from "./debugging-welcome-screen";

function suggestions() {
  return within(
    screen.getByRole("list", { name: "Start an investigation" }),
  ).getAllByRole("button");
}

beforeEach(() => {
  navigationStore.back();
});

describe("Home", () => {
  it("asks what to debug and offers three investigations", () => {
    render(<DebuggingWelcomeScreen onSuggestionClick={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "What are we debugging?" }),
    ).toBeVisible();
    expect(suggestions().map((row) => row.textContent)).toEqual([
      "WidgetWhy isn't my Apty Widget showing?",
      "StudioWhy can't Studio select this element?",
      "WorkflowWhy did this workflow stop?",
    ]);
  });

  it("sends a suggestion's question when it is chosen", () => {
    const onSuggestionClick = vi.fn();
    render(<DebuggingWelcomeScreen onSuggestionClick={onSuggestionClick} />);
    fireEvent.click(suggestions()[1] as HTMLElement);
    expect(onSuggestionClick).toHaveBeenCalledWith(
      "Why can't Studio select this element?",
    );
  });

  it("shows all six with See all, and three again with Show fewer", () => {
    render(<DebuggingWelcomeScreen onSuggestionClick={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: "See all" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(suggestions()).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(suggestions()).toHaveLength(3);
  });

  it("opens the DOM config page instead of sending a message", () => {
    const onSuggestionClick = vi.fn();
    render(<DebuggingWelcomeScreen onSuggestionClick={onSuggestionClick} />);
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /Generate DOM config: capture this application's pages/,
      }),
    );
    expect(navigationStore.getState().page).toBe("dom-config");
    expect(onSuggestionClick).not.toHaveBeenCalled();
  });
});
