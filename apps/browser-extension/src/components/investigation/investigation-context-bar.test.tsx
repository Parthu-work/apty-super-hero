import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigationStore } from "../../state/navigation-store";

const mocks = vi.hoisted(() => ({ readiness: vi.fn() }));

vi.mock("@apty/browser-runtime", () => ({ stopInvestigation: vi.fn() }));
vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: () => ({
    sessionId: "s1",
    status: "idle",
    interrupt: vi.fn(),
  }),
}));
vi.mock("./use-investigation-data", () => ({
  useInvestigationData: () => ({ investigation: null }),
}));
vi.mock("../connections/use-readiness", () => ({
  useReadiness: mocks.readiness,
}));

import { InvestigationContextBar } from "./investigation-context-bar";

const TARGET = {
  tabId: 1,
  title: "Orders",
  hostname: "app.example.com",
  inspectable: false,
  detail: "",
  checking: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  act(() => navigationStore.back());
});

describe("InvestigationContextBar", () => {
  it("names the page and opens Connections from the setup badge", () => {
    mocks.readiness.mockReturnValue({ target: TARGET, setupCount: 2 });
    render(<InvestigationContextBar />);

    expect(screen.getByText("Can't inspect")).toBeInTheDocument();
    expect(screen.getByText("app.example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2 to set up" }));
    expect(navigationStore.getState().page).toBe("connections");
  });

  it("leaves the badge to the Connections page's own header there, and hides it at zero", () => {
    mocks.readiness.mockReturnValue({ target: TARGET, setupCount: 1 });
    act(() => navigationStore.openPage("connections"));
    const { rerender } = render(<InvestigationContextBar />);
    expect(screen.queryByRole("button", { name: /to set up/ })).toBeNull();

    act(() => navigationStore.back());
    mocks.readiness.mockReturnValue({ target: TARGET, setupCount: 0 });
    rerender(<InvestigationContextBar />);
    expect(screen.queryByRole("button", { name: /to set up/ })).toBeNull();
  });

  it("says it is checking until the tab has been read, not that it can't inspect", () => {
    mocks.readiness.mockReturnValue({
      target: { ...TARGET, hostname: null, title: null, checking: true },
      setupCount: 0,
    });
    render(<InvestigationContextBar />);
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.queryByText("Can't inspect")).toBeNull();
    expect(screen.queryByText("No page selected")).toBeNull();
  });
});
