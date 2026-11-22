import { closeCase, newCase } from "@apty/agent-core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  list: vi.fn(),
  startNew: vi.fn(),
  openOptions: vi.fn(),
}));

vi.mock("../../services/cases", () => ({
  caseRecorder: () => ({
    current: mocks.current,
    subscribe: () => () => undefined,
    startNew: mocks.startNew,
    store: { list: mocks.list },
  }),
  caseStore: () => ({ list: async () => [] }),
  setActiveConversation: vi.fn(),
}));
vi.mock("../../lib/open-options", () => ({ openOptions: mocks.openOptions }));
vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: () => ({ sessionId: "conv-1" }),
}));
vi.mock("../connections/use-readiness", () => ({
  useReadiness: () => ({ target: { hostname: "app.example.com" } }),
}));

import { CaseChip } from "./case-chip";

const NOW = new Date("2026-11-22T10:00:00.000Z");

function openMenu() {
  fireEvent.keyDown(screen.getByTestId("case-chip"), { key: "Enter" });
  return screen.getByRole("menu");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
});

describe("the case chip (KB-RAG K29, L1)", () => {
  it("shows the short id, names the full one, and keeps every case action one click away", async () => {
    const record = {
      ...newCase("conv-1", NOW, { tabHost: "app.example.com" }),
      id: "CASE-20261122-AB12",
    };
    mocks.current.mockResolvedValue(record);
    render(<CaseChip />);
    const chip = await screen.findByTestId("case-chip");
    expect(chip).toHaveTextContent("AB12");
    expect(chip).toHaveAccessibleName("Case CASE-20261122-AB12");

    const menu = openMenu();
    expect(within(menu).getByText("CASE-20261122-AB12")).toBeInTheDocument();
    expect(within(menu).getByTestId("case-site")).toHaveTextContent(
      "Site: app.example.com",
    );
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Copy case id", "New case", "Close case…", "Open in Cases"]);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "New case" }));
    expect(mocks.startNew).toHaveBeenCalledWith("conv-1", "app.example.com");

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Open in Cases" }),
    );
    expect(mocks.openOptions).toHaveBeenCalledWith({ section: "cases" });

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Close case…" }),
    );
    expect(await screen.findByTestId("close-case-form")).toBeInTheDocument();
  });

  it("shows how a closed case ended and offers no Close case", async () => {
    const record = closeCase(
      newCase("conv-1", NOW, { tabHost: "app.example.com" }),
      "resolved",
      NOW,
    );
    mocks.current.mockResolvedValue(record);
    render(<CaseChip />);
    expect(await screen.findByTestId("case-outcome")).toHaveTextContent(
      "Resolved",
    );
    expect(
      within(openMenu()).queryByRole("menuitem", { name: "Close case…" }),
    ).toBeNull();
  });
});
