import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigationStore } from "../../state/navigation-store";

const storage = vi.hoisted(() => ({
  getAllConversations: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock("@apty/browser-runtime", () => ({ conversationStorage: storage }));

import { MenuDrawer, type MenuDrawerProps } from "./menu-drawer";

const NOW = Date.now();

function setup(overrides: Partial<MenuDrawerProps> = {}) {
  const menuButtonRef = createRef<HTMLButtonElement>();
  const props: MenuDrawerProps = {
    menuButtonRef,
    onNewChat: vi.fn(),
    onSelectConversation: vi.fn(),
    onConversationDeleted: vi.fn(),
    onSendPrompt: vi.fn(),
    onOpenSettings: vi.fn(),
    setupCount: 0,
    ...overrides,
  };
  render(
    <>
      <button type="button" ref={menuButtonRef}>
        Menu
      </button>
      <MenuDrawer {...props} />
    </>,
  );
  return props;
}

async function openMenu() {
  act(() => navigationStore.openDrawer());
  return screen.findByRole("dialog", { name: "Menu" });
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => {
    navigationStore.back();
    navigationStore.closeDrawer();
  });
  storage.getAllConversations.mockResolvedValue([
    {
      id: "a",
      title: "Why isn't my Apty Widget showing?",
      updatedAt: NOW - 12 * 60_000,
    },
    {
      id: "b",
      title: "Is this selector reliable?",
      updatedAt: NOW - 90 * 60_000,
    },
  ]);
  storage.deleteConversation.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MenuDrawer", () => {
  it("opens a tool page from the menu, which then closes", async () => {
    setup();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("button", { name: /^DOM health/ }));
    expect(navigationStore.getState()).toMatchObject({
      page: "dom-health",
      origin: "menu",
      drawerOpen: false,
    });
  });

  it("opens the DOM config page", async () => {
    setup();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("button", { name: /^DOM config/ }));
    expect(navigationStore.getState()).toMatchObject({
      page: "dom-config",
      origin: "menu",
    });
  });

  it("shows each tool's status on its row", async () => {
    setup();
    const menu = await openMenu();
    expect(
      within(menu).getByRole("button", { name: /^DOM health/ }),
    ).toHaveTextContent("Not checked");
    expect(
      within(menu).getByRole("button", { name: /^DOM config/ }),
    ).toHaveTextContent("Not generated");
  });

  it("sends the guided prompts for the selector checker and the network inspector", async () => {
    const props = setup();
    let menu = await openMenu();
    fireEvent.click(
      within(menu).getByRole("button", { name: "Selector checker" }),
    );
    expect(props.onSendPrompt).toHaveBeenCalledWith(
      "Is this selector reliable?",
    );
    expect(navigationStore.getState().drawerOpen).toBe(false);

    menu = await openMenu();
    fireEvent.click(
      within(menu).getByRole("button", { name: "Network inspector" }),
    );
    expect(props.onSendPrompt).toHaveBeenLastCalledWith(
      "What caused this network failure?",
    );
  });

  it("lists recent chats with their time, newest first, and opens one", async () => {
    const props = setup({ currentConversationId: "b" });
    const menu = await openMenu();
    const row = await within(menu).findByRole("button", {
      name: /^Why isn't my Apty Widget showing\?/,
    });
    expect(row).toHaveTextContent("12 min ago");
    expect(
      within(menu).getByRole("button", {
        name: /^Is this selector reliable\?/,
      }),
    ).toHaveAttribute("aria-current", "page");

    fireEvent.click(row);
    expect(props.onSelectConversation).toHaveBeenCalledWith("a");
  });

  it("deletes a chat only after the confirmation, which opens on Cancel", async () => {
    const props = setup();
    const menu = await openMenu();
    fireEvent.click(
      await within(menu).findByRole("button", {
        name: "Delete conversation: Is this selector reliable?",
      }),
    );
    const confirm = screen.getByRole("alertdialog", {
      name: "Delete this chat?",
    });
    expect(confirm).toHaveTextContent(
      '"Is this selector reliable?" will be removed from this browser. This can\'t be undone.',
    );
    expect(
      within(confirm).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
    expect(storage.deleteConversation).not.toHaveBeenCalled();

    storage.getAllConversations.mockResolvedValue([
      {
        id: "a",
        title: "Why isn't my Apty Widget showing?",
        updatedAt: NOW - 12 * 60_000,
      },
    ]);
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(props.onConversationDeleted).toHaveBeenCalledWith("b"),
    );
    expect(storage.deleteConversation).toHaveBeenCalledWith("b");
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(
      within(menu).queryByRole("button", {
        name: /^Is this selector reliable/,
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps the chat when the confirmation is cancelled, and returns focus to its delete button", async () => {
    const props = setup();
    const menu = await openMenu();
    const remove = await within(menu).findByRole("button", {
      name: "Delete conversation: Is this selector reliable?",
    });
    remove.focus();
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(remove).toHaveFocus());
    expect(storage.deleteConversation).not.toHaveBeenCalled();
    expect(props.onConversationDeleted).not.toHaveBeenCalled();
  });

  it("quotes a long title in the confirmation cut to 60 characters", async () => {
    const title = `Why does the ${"very ".repeat(20)}long workflow stop?`;
    storage.getAllConversations.mockResolvedValue([
      { id: "long", title, updatedAt: NOW },
    ]);
    setup();
    const menu = await openMenu();
    fireEvent.click(
      await within(menu).findByRole("button", {
        name: `Delete conversation: ${title}`,
      }),
    );

    const quoted = /"(.*)"/.exec(
      screen.getByRole("alertdialog").textContent ?? "",
    )?.[1];
    expect(quoted).toHaveLength(60);
    expect(quoted?.endsWith("…")).toBe(true);
  });

  it("names the site a chat was saved on, and only the time when it has none", async () => {
    storage.getAllConversations.mockResolvedValue([
      {
        id: "a",
        title: "Why isn't my Apty Widget showing?",
        updatedAt: NOW - 12 * 60_000,
        siteHost: "app.example.com",
      },
      {
        id: "b",
        title: "Is this selector reliable?",
        updatedAt: NOW - 90 * 60_000,
      },
    ]);
    setup();
    const menu = await openMenu();

    expect(
      await within(menu).findByRole("button", {
        name: /^Why isn't my Apty Widget showing\?/,
      }),
    ).toHaveTextContent(
      /^AWhy isn't my Apty Widget showing\?app\.example\.com · 12 min ago$/,
    );
    expect(
      within(menu).getByRole("button", { name: /^Is this selector reliable/ }),
    ).toHaveTextContent(/^Is this selector reliable\?1 hour ago$/);
  });

  it("says it is loading the recent chats, then that there are none", async () => {
    let resolve: (value: unknown[]) => void = () => {};
    storage.getAllConversations.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    setup();
    const menu = await openMenu();

    expect(within(menu).getByRole("status")).toHaveTextContent("Loading...");
    expect(within(menu).getByText("Recent chats")).toBeInTheDocument();

    await act(async () => resolve([]));
    expect(
      within(menu).getByText("No conversation history"),
    ).toBeInTheDocument();
    expect(
      within(menu).queryByRole("button", { name: "View all" }),
    ).not.toBeInTheDocument();
  });

  it("says when the recent chats can't be loaded, and Retry loads them again", async () => {
    storage.getAllConversations.mockRejectedValueOnce(new Error("closed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    setup();
    const menu = await openMenu();

    const alert = await within(menu).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load recent chats.");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(
      await within(menu).findByRole("button", {
        name: /^Why isn't my Apty Widget showing\?/,
      }),
    ).toBeInTheDocument();
  });

  it("keeps Tab inside the menu while it is open", async () => {
    setup();
    const menu = await openMenu();
    const close = within(menu).getByRole("button", { name: "Close menu" });
    const settings = within(menu).getByRole("button", { name: "Settings" });

    settings.focus();
    fireEvent.keyDown(settings, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(settings).toHaveFocus();
  });

  it("closes on Escape and returns focus to the Menu button", async () => {
    setup();
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(navigationStore.getState().drawerOpen).toBe(false);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus(),
    );
  });

  it("opens Connections as a page, with the setup badge only when something needs setting up", async () => {
    setup({ setupCount: 2 });
    let menu = await openMenu();
    const connections = within(menu).getByRole("button", {
      name: /^Connections/,
    });
    expect(connections).toHaveTextContent("2 to set up");
    fireEvent.click(connections);
    expect(navigationStore.getState()).toMatchObject({
      page: "connections",
      origin: "menu",
      drawerOpen: false,
    });

    cleanup();
    setup({ setupCount: 0 });
    menu = await openMenu();
    expect(
      within(menu).getByRole("button", { name: /^Connections/ }),
    ).not.toHaveTextContent("to set up");
  });

  it("marks the open tool page as current", async () => {
    setup();
    act(() => navigationStore.openPage("dom-config", "menu"));
    const menu = await openMenu();
    expect(
      within(menu).getByRole("button", { name: /^DOM config/ }),
    ).toHaveAttribute("aria-current", "page");
  });
});
