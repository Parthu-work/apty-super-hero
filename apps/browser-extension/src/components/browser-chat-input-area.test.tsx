import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  openOptions: vi.fn(),
}));

vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: () => ({ sendMessage: vi.fn() }),
  useConfigContext: () => ({ settings: mocks.settings }),
}));
vi.mock("@apty/ui/components/chatbot/components", () => ({
  DefaultInputArea: ({ modelControl }: { modelControl?: ReactNode }) => (
    <div>{modelControl ?? <span>Model selector</span>}</div>
  ),
}));
vi.mock("../lib/open-options", () => ({ openOptions: mocks.openOptions }));

import { BrowserChatInputArea } from "./browser-chat-input-area";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("BrowserChatInputArea — provider control", () => {
  it("shows a Set up AI provider chip, which opens the provider settings, until a provider is configured", () => {
    mocks.settings = {};
    render(
      <BrowserChatInputArea
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        status="idle"
      />,
    );

    expect(screen.queryByText("Model selector")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up AI provider" }));
    expect(mocks.openOptions).toHaveBeenCalledWith({ section: "ai-provider" });
  });

  it("keeps the model selector once a provider is configured", () => {
    mocks.settings = { aiToken: "key", aiModel: "gpt-4o" };
    render(
      <BrowserChatInputArea
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        status="idle"
      />,
    );

    expect(screen.getByText("Model selector")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Set up AI provider" }),
    ).toBeNull();
  });
});
