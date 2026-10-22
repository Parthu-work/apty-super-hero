import { I18nProvider } from "@apty/ui/i18n/context";
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

  it.each([
    "idle",
    "error",
  ] as const)("is a Send button that submits the form when %s", (status) => {
    const onFormSubmit = vi.fn((event: React.FormEvent) =>
      event.preventDefault(),
    );
    render(
      <form onSubmit={onFormSubmit}>
        <AutomationModeInputToolbar status={status} onStop={onStop} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onFormSubmit).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it.each([
    ["idle", "发送"],
    ["streaming", "停止"],
  ] as const)("names the submit button in the UI language when %s", async (status, name) => {
    const languageStorage = {
      load: vi.fn().mockResolvedValue("zh"),
      save: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    render(
      <I18nProvider storageAdapter={languageStorage as never}>
        <AutomationModeInputToolbar status={status} onStop={onStop} />
      </I18nProvider>,
    );

    expect(await screen.findByRole("button", { name })).toBeTruthy();
  });

  it("names the icon-only automation mode button", () => {
    render(<AutomationModeInputToolbar status="idle" onStop={onStop} />);
    expect(
      screen.getByRole("button", {
        name: "Select automation mode: Focus Mode",
      }),
    ).toBeTruthy();
  });
});
