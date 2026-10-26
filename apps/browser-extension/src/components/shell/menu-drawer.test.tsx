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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigationStore } from "../../state/navigation-store";
import { domConfigStore } from "../investigation/dom-config/dom-config-store";

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

  it("opens the DOM config page with its card expanded", async () => {
    setup();
    act(() => domConfigStore.setExpanded(false));
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("button", { name: /^DOM config/ }));
    expect(navigationStore.getState()).toMatchObject({
      page: "dom-config",
      origin: "menu",
    });
    expect(domConfigStore.getState().expanded).toBe(true);
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

  it("deletes a chat from its row action", async () => {
    const props = setup();
    const menu = await openMenu();
    fireEvent.click(
      await within(menu).findByRole("button", {
        name: "Delete conversation: Is this selector reliable?",
      }),
    );
    await waitFor(() =>
      expect(props.onConversationDeleted).toHaveBeenCalledWith("b"),
    );
    expect(storage.deleteConversation).toHaveBeenCalledWith("b");
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
