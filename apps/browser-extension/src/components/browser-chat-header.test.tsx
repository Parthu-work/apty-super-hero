import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigationStore } from "../state/navigation-store";

// New chat (header icon and menu row) must save the conversation at once,
// not racing the 1 s debounce, and confirm before stopping a running reply.

const mockUseChatContext = vi.hoisted(() => vi.fn());
const mockSaveConversation = vi.hoisted(() => vi.fn());
const menuDrawerProps = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: mockUseChatContext,
}));

vi.mock("@apty/ui/i18n/context", () => ({
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
}));

vi.mock("@apty/browser-runtime", () => ({
  conversationStorage: {
    updateConversation: vi.fn(),
    saveConversation: mockSaveConversation,
    getConversation: vi.fn(),
  },
}));

vi.mock("../lib/open-options", () => ({ openOptions: vi.fn() }));

vi.mock("./shell/menu-drawer", () => ({
  MenuDrawer: (props: unknown) => {
    menuDrawerProps.current = props;
    return null;
  },
}));

vi.mock("./investigation/investigation-context-bar", () => ({
  InvestigationContextBar: () => null,
}));

vi.mock("./connections/use-readiness", () => ({
  useReadiness: () => ({ setupCount: 2 }),
}));

import { BrowserChatHeader } from "./browser-chat-header";

function userMessage(id: string) {
  return {
    id,
    role: "user" as const,
    parts: [{ type: "text" as const, text: "hi" }],
  };
}

function chat(status: string, interrupt = vi.fn()) {
  mockUseChatContext.mockReturnValue({
    messages: [userMessage("1"), userMessage("2")],
    status,
    setMessages: vi.fn(),
    interrupt,
    sessionId: "session-1",
    bindSession: vi.fn(),
    sendMessage: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationStore.back();
  navigationStore.closeDrawer();
  mockSaveConversation.mockResolvedValue("conv-1");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BrowserChatHeader — New chat", () => {
  it("saves the conversation immediately, then starts a new chat", async () => {
    const onNewChat = vi.fn();
    chat("idle");

    render(<BrowserChatHeader onNewChat={onNewChat} />);
    fireEvent.click(screen.getByRole("button", { name: "shell.newChat" }));

    await vi.waitFor(() => expect(onNewChat).toHaveBeenCalled());
    expect(mockSaveConversation).toHaveBeenCalled();
    expect(mockSaveConversation.mock.invocationCallOrder[0]).toBeLessThan(
      onNewChat.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does nothing when the user cancels stopping a running reply", () => {
    const onNewChat = vi.fn();
    const interrupt = vi.fn();
    chat("streaming", interrupt);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<BrowserChatHeader onNewChat={onNewChat} />);
    fireEvent.click(screen.getByRole("button", { name: "shell.newChat" }));

    expect(confirmSpy).toHaveBeenCalledWith("shell.newChatConfirm");
    expect(interrupt).not.toHaveBeenCalled();
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it("interrupts the running reply, saves, then starts a new chat when confirmed", async () => {
    const onNewChat = vi.fn();
    const interrupt = vi.fn().mockResolvedValue(undefined);
    chat("streaming", interrupt);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<BrowserChatHeader onNewChat={onNewChat} />);
    fireEvent.click(screen.getByRole("button", { name: "shell.newChat" }));

    await vi.waitFor(() => expect(onNewChat).toHaveBeenCalled());
    expect(interrupt.mock.invocationCallOrder[0]).toBeLessThan(
      mockSaveConversation.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("gives the menu's New chat row the same path", async () => {
    const onNewChat = vi.fn();
    chat("idle");

    render(<BrowserChatHeader onNewChat={onNewChat} />);
    (menuDrawerProps.current as { onNewChat: () => void }).onNewChat();

    await vi.waitFor(() => expect(onNewChat).toHaveBeenCalled());
    expect(mockSaveConversation).toHaveBeenCalled();
  });
});

describe("BrowserChatHeader — Alt+Left", () => {
  it("goes back one page when a tool page is open, keeping the chat", () => {
    const onNewChat = vi.fn();
    chat("idle");
    navigationStore.openPage("dom-health");

    render(<BrowserChatHeader onNewChat={onNewChat} />);
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });

    expect(navigationStore.getState().page).toBeNull();
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it("starts a new chat when no page is open", async () => {
    const onNewChat = vi.fn();
    chat("idle");

    render(<BrowserChatHeader onNewChat={onNewChat} />);
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });

    await vi.waitFor(() => expect(onNewChat).toHaveBeenCalled());
  });
});

describe("BrowserChatHeader — Menu", () => {
  it("opens the menu and reports it as expanded", () => {
    chat("idle");
    const { rerender } = render(<BrowserChatHeader />);
    const menu = screen.getByRole("button", { name: "shell.menu" });
    expect(menu).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(menu);
    rerender(<BrowserChatHeader />);

    expect(navigationStore.getState().drawerOpen).toBe(true);
    expect(menu).toHaveAttribute("aria-expanded", "true");
  });

  it("gives the menu the setup count for its Connections badge", () => {
    chat("idle");
    render(<BrowserChatHeader />);
    expect(menuDrawerProps.current).toMatchObject({ setupCount: 2 });
  });
});
