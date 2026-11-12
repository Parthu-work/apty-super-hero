import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetupNeededCard } from "./setup-needed-card";

describe("SetupNeededCard", () => {
  it("says the draft was not sent, offers setup and Dismiss", () => {
    const onOpenSettings = vi.fn();
    const onDismiss = vi.fn();
    render(
      <SetupNeededCard
        draftText="  Why isn't the widget showing?  "
        onOpenSettings={onOpenSettings}
        onDismiss={onDismiss}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Connect an AI provider");
    expect(notice).toHaveTextContent(
      "Your message wasn't sent: “Why isn't the widget showing?”",
    );
    fireEvent.click(screen.getByRole("button", { name: "Set up AI provider" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("shortens a long draft to 160 characters", () => {
    render(
      <SetupNeededCard
        draftText={"x".repeat(200)}
        onOpenSettings={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      `“${"x".repeat(160)}…”`,
    );
  });
});

describe("SetupNeededCard with the KB's reason (KB-RAG K25, A2)", () => {
  it("shows why no card answered in place of the generic text", () => {
    render(
      <SetupNeededCard
        draftText="how much does it cost"
        kbLine="No KB card matched (coverage 0.12, needs 0.50)."
        onOpenSettings={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(
      "No KB card matched (coverage 0.12, needs 0.50). Connect an AI provider to ask the AI model.",
    );
    expect(notice).not.toHaveTextContent("Add your own API key");
  });
});
