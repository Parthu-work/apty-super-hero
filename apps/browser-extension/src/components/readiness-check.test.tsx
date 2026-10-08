import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  checkClient: vi.fn(),
  openOptions: vi.fn(),
}));

vi.mock("@apty/browser-runtime", () => ({
  getAptyIntegrationConfig: mocks.getConfig,
}));
vi.mock("../services/apty-client-check", () => ({
  checkClient: mocks.checkClient,
}));
vi.mock("../lib/open-options", () => ({ openOptions: mocks.openOptions }));

import { describePage, ReadinessCheck } from "./readiness-check";

const CONFIGURED = { aiToken: "key", aiModel: "gpt-4o" };

function mockActiveTab(url: string | undefined) {
  (globalThis as any).chrome = {
    tabs: {
      query: vi.fn().mockResolvedValue([{ url }]),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getConfig.mockResolvedValue({});
  mockActiveTab("https://app.example.com/home");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describePage", () => {
  it("accepts web pages and local files", () => {
    expect(describePage("https://app.example.com/x").inspectable).toBe(true);
    expect(describePage("http://localhost:3000").inspectable).toBe(true);
    expect(describePage("file:///tmp/a.html").inspectable).toBe(true);
  });

  it("asks for file access when Chrome withholds it", () => {
    expect(describePage("file:///tmp/a.html", false)).toEqual({
      inspectable: false,
      detail:
        'Turn on "Allow access to file URLs" for Apty Agent in chrome://extensions to inspect local files.',
    });
  });

  it("explains pages Chrome keeps extensions out of", () => {
    expect(describePage("chrome://extensions")).toEqual({
      inspectable: false,
      detail:
        "Chrome doesn't let extensions inspect chrome: pages. Open the page you want to investigate.",
    });
    expect(
      describePage("https://chromewebstore.google.com/detail/x").detail,
    ).toMatch(/chromewebstore\.google\.com pages/);
    expect(describePage(undefined).inspectable).toBe(false);
  });
});

describe("ReadinessCheck", () => {
  it("sends a user without a provider to the AI provider settings", async () => {
    render(<ReadinessCheck settings={{}} />);

    expect(screen.getByText(/Add your own API key/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(mocks.openOptions).toHaveBeenCalledWith({ section: "ai-provider" });
    expect(await screen.findByText("Apty Client not connected")).toBeTruthy();
  });

  it("shows a ready state when the provider, Client and page all check out", async () => {
    mocks.getConfig.mockResolvedValue({
      clientExtensionId: "abcdefghijklmnopabcdefghijklmnop",
    });
    mocks.checkClient.mockResolvedValue({ status: "ok" });

    render(<ReadinessCheck settings={CONFIGURED} />);

    expect(screen.getByText("gpt-4o")).toBeTruthy();
    expect(await screen.findByText("Apty Client connected")).toBeTruthy();
    expect(await screen.findByText("app.example.com")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("passes on why the Client didn't answer, with a way to fix it", async () => {
    mocks.getConfig.mockResolvedValue({
      clientExtensionId: "abcdefghijklmnopabcdefghijklmnop",
    });
    mocks.checkClient.mockResolvedValue({
      status: "not_answering",
      message: "The Apty Client does not allow-list this Agent.",
    });

    render(<ReadinessCheck settings={CONFIGURED} />);

    expect(await screen.findByText(/does not allow-list/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(mocks.openOptions).toHaveBeenCalledWith({ section: "apty-client" });
  });
});
