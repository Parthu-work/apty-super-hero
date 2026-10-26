import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigationStore } from "../../state/navigation-store";
import type { Readiness } from "./use-readiness";

const mocks = vi.hoisted(() => ({
  readiness: vi.fn(),
  connect: vi.fn(),
  refresh: vi.fn(),
  openOptions: vi.fn(),
}));

vi.mock("./use-readiness", () => ({ useReadiness: mocks.readiness }));
vi.mock("../../state/readiness-store", () => ({
  peerStore: { connect: mocks.connect, refresh: mocks.refresh },
}));
vi.mock("../../lib/open-options", () => ({ openOptions: mocks.openOptions }));
vi.mock("../shell/tool-page-shell", () => ({
  ToolPageShell: ({
    title,
    trailing,
    children,
  }: {
    title: string;
    trailing?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h2>{title}</h2>
      {trailing}
      {children}
    </div>
  ),
}));

import { ConnectionsPage } from "./connections-page";

const OWN_ID = "ownidownidownidownidownidownidow";
const CLIENT_ID = "abcdefghijklmnopabcdefghijklmnop";

function readiness(overrides: Partial<Readiness> = {}): Readiness {
  return {
    states: { provider: "ok", client: "info", studio: "info", page: "ok" },
    setupCount: 0,
    peers: {
      client: { kind: "not-configured" },
      studio: { kind: "not-configured" },
    },
    target: {
      tabId: 1,
      title: "Orders",
      hostname: "app.example.com",
      inspectable: true,
      detail: "Ready to inspect app.example.com.",
      checking: false,
    },
    model: "gpt-4o",
    ...overrides,
  };
}

const card = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readiness.mockReturnValue(readiness());
  mocks.refresh.mockResolvedValue(undefined);
  vi.stubGlobal("chrome", { runtime: { id: OWN_ID } });
  act(() => navigationStore.back());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConnectionsPage", () => {
  it("shows this panel's own extension ID for each allow-list, with a Copy ID button", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ConnectionsPage />);

    for (const [name, label] of [
      ["Apty Client", "Add this panel's ID to the Client's allow-list"],
      ["Apty Studio", "Add this panel's ID to Studio's allow-list"],
    ] as const) {
      expect(within(card(name)).getByLabelText(label)).toHaveValue(OWN_ID);
    }
    fireEvent.click(
      within(card("Apty Client")).getByRole("button", { name: "Copy ID" }),
    );
    expect(writeText).toHaveBeenCalledWith(OWN_ID);
  });

  it("asks for the full ID, and does not connect, when the ID is not a Chrome extension ID", () => {
    render(<ConnectionsPage />);
    const client = card("Apty Client");
    const input = within(client).getByLabelText("Extension ID");

    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.click(
      within(client).getByRole("button", { name: "Connect Apty Client" }),
    );

    expect(within(client).getByText("Enter the full ID.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("connects a valid ID and says why it failed", async () => {
    mocks.connect.mockResolvedValue({
      status: "error",
      message: "The specified Apty Studio extension could not be found.",
    });
    render(<ConnectionsPage />);
    const studio = card("Apty Studio");

    fireEvent.change(within(studio).getByLabelText("Extension ID"), {
      target: { value: ` ${CLIENT_ID} ` },
    });
    fireEvent.click(
      within(studio).getByRole("button", { name: "Connect Apty Studio" }),
    );

    expect(mocks.connect).toHaveBeenCalledWith("studio", CLIENT_ID);
    expect(await within(studio).findByRole("alert")).toHaveTextContent(
      "could not be found",
    );
  });

  it("fills in a saved ID and shows a configured peer that does not answer", () => {
    mocks.readiness.mockReturnValue(
      readiness({
        setupCount: 1,
        peers: {
          client: {
            kind: "not-answering",
            extensionId: CLIENT_ID,
            message: "The Apty Client does not allow-list this Agent.",
          },
          studio: { kind: "not-configured" },
        },
      }),
    );
    render(<ConnectionsPage />);
    const client = card("Apty Client");

    expect(within(client).getByLabelText("Extension ID")).toHaveValue(
      CLIENT_ID,
    );
    expect(within(client).getByText("Not answering")).toBeInTheDocument();
    expect(within(client).getByRole("status")).toHaveTextContent(
      "does not allow-list",
    );
    expect(screen.getByText("1 to set up")).toBeInTheDocument();
    expect(
      within(card("Apty Studio")).getByText("Not connected"),
    ).toBeInTheDocument();
  });

  it("sends a missing provider to the AI provider settings", () => {
    mocks.readiness.mockReturnValue(
      readiness({
        states: {
          provider: "warning",
          client: "info",
          studio: "info",
          page: "ok",
        },
        model: undefined,
        setupCount: 1,
      }),
    );
    render(<ConnectionsPage />);

    expect(
      screen.getByText("Set up the AI provider first to start chatting."),
    ).toBeInTheDocument();
    const provider = card("AI provider");
    expect(within(provider).getByText("Needs setup")).toBeInTheDocument();
    fireEvent.click(
      within(provider).getByRole("button", { name: "Set up AI provider" }),
    );
    expect(mocks.openOptions).toHaveBeenCalledWith({ section: "ai-provider" });
  });

  it("re-checks the Client and Studio each time the page opens", () => {
    render(<ConnectionsPage />);
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => navigationStore.openPage("connections"));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
