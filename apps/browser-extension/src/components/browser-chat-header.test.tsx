import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WP17: a Back control should appear once a conversation exists, save the
// conversation immediately (not racing the 1s debounce) before clearing
// it, and confirm before discarding an in-progress run.

const mockUseChatContext = vi.hoisted(() => vi.fn());
const mockUseTranslation = vi.hoisted(() => vi.fn());
const mockGetRuntime = vi.hoisted(() => vi.fn());
const mockUpdateConversation = vi.hoisted(() => vi.fn());
const mockSaveConversation = vi.hoisted(() => vi.fn());

vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: mockUseChatContext,
}));

vi.mock("@apty/ui/i18n/context", () => ({
  useTranslation: mockUseTranslation,
}));

vi.mock("@apty/ui/lib/runtime", () => ({
  getRuntime: mockGetRuntime,
}));

vi.mock("@apty/browser-runtime", () => ({
  conversationStorage: {
    updateConversation: mockUpdateConversation,
    saveConversation: mockSaveConversation,
    getConversation: vi.fn(),
  },
}));

vi.mock("./conversation-history", () => ({
  ConversationHistory: () => <div data-testid="conversation-history" />,
}));

vi.mock("./investigation/investigation-context-bar", () => ({
  InvestigationContextBar: () => null,
}));

import { BrowserChatHeader } from "./browser-chat-header";

function userMessage(id: string) {
  return {
    id,
    role: "user" as const,
    parts: [{ type: "text" as const, text: "hi" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseTranslation.mockReturnValue({
    t: (key: string) => key,
    language: "en",
  });
  mockGetRuntime.mockReturnValue(undefined);
  mockSaveConversation.mockResolvedValue("conv-1");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BrowserChatHeader — Back control", () => {
  it("is not rendered when the conversation is empty", () => {
    mockUseChatContext.mockReturnValue({
      messages: [],
      status: "idle",
      setMessages: vi.fn(),
      interrupt: vi.fn(),
      sessionId: null,
      bindSession: vi.fn(),
    });

    render(<BrowserChatHeader />);

    expect(screen.queryByRole("button", { name: "tooltip.back" })).toBeNull();
  });

  it("saves the conversation immediately and calls onNewChat when idle", async () => {
    const onNewChat = vi.fn();
    mockUseChatContext.mockReturnValue({
      messages: [userMessage("1"), userMessage("2")],
      status: "idle",
      setMessages: vi.fn(),
      interrupt: vi.fn(),
      sessionId: "session-1",
      bindSession: vi.fn(),
    });

    render(<BrowserChatHeader onNewChat={onNewChat} />);

    fireEvent.click(screen.getByRole("button", { name: "tooltip.back" }));

    await vi.waitFor(() => {
      expect(mockSaveConversation).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(onNewChat).toHaveBeenCalled();
    });
  });

  it("confirms before discarding an in-progress run, and does nothing on cancel", async () => {
    const onNewChat = vi.fn();
    const interrupt = vi.fn();
    mockUseChatContext.mockReturnValue({
      messages: [userMessage("1"), userMessage("2")],
      status: "streaming",
      setMessages: vi.fn(),
      interrupt,
      sessionId: "session-1",
      bindSession: vi.fn(),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<BrowserChatHeader onNewChat={onNewChat} />);
    fireEvent.click(screen.getByRole("button", { name: "tooltip.back" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(interrupt).not.toHaveBeenCalled();
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it("interrupts and goes back when the user confirms leaving an in-progress run", async () => {
    const onNewChat = vi.fn();
    const interrupt = vi.fn().mockResolvedValue(undefined);
    mockUseChatContext.mockReturnValue({
      messages: [userMessage("1"), userMessage("2")],
      status: "streaming",
      setMessages: vi.fn(),
      interrupt,
      sessionId: "session-1",
      bindSession: vi.fn(),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<BrowserChatHeader onNewChat={onNewChat} />);
    fireEvent.click(screen.getByRole("button", { name: "tooltip.back" }));

    await vi.waitFor(() => {
      expect(interrupt).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(onNewChat).toHaveBeenCalled();
    });
  });

  it("responds to the Alt+Left keyboard shortcut", async () => {
    const onNewChat = vi.fn();
    mockUseChatContext.mockReturnValue({
      messages: [userMessage("1"), userMessage("2")],
      status: "idle",
      setMessages: vi.fn(),
      interrupt: vi.fn(),
      sessionId: "session-1",
      bindSession: vi.fn(),
    });

    render(<BrowserChatHeader onNewChat={onNewChat} />);

    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });

    await vi.waitFor(() => {
      expect(onNewChat).toHaveBeenCalled();
    });
  });
});
