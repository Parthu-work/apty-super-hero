import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime/hooks", () => ({
  useStorage: () => ["focus", vi.fn(), false],
}));

vi.mock("@apty/ui/components/chatbot", () => ({
  TokenUsageIndicator: () => null,
}));

import { AutomationModeInputToolbar } from "./automation-mode-toolbar";

const onStop = vi.fn();

beforeEach(() => {
  onStop.mockReset();
});

describe("AutomationModeInputToolbar", () => {
  it.each([
    "submitted",
    "streaming",
  ] as const)("is a Stop button while the turn is %s, and never submits the form", (status) => {
    const onFormSubmit = vi.fn((event: React.FormEvent) =>
      event.preventDefault(),
    );
    render(
      <form onSubmit={onFormSubmit}>
        <AutomationModeInputToolbar status={status} onStop={onStop} />
      </form>,
    );

    const button = screen.getByRole("button", { name: "Stop" });
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onFormSubmit).not.toHaveBeenCalled();
  });

  it("is a Send button that submits the form when idle", () => {
    const onFormSubmit = vi.fn((event: React.FormEvent) =>
      event.preventDefault(),
    );
    render(
      <form onSubmit={onFormSubmit}>
        <AutomationModeInputToolbar status="idle" onStop={onStop} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onFormSubmit).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });
});
