import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateConfig = vi.hoisted(() => vi.fn());

vi.mock("@apty/browser-runtime", () => ({
  getAptyIntegrationConfig: vi.fn().mockResolvedValue({}),
  updateAptyIntegrationConfig: mockUpdateConfig,
  isValidExtensionId: (id: string) => /^[a-p]{32}$/.test(id),
}));

import { AptyClientPanel } from "./apty-client-panel";

const CLIENT_ID = "a".repeat(32);
const mockManagementGet = vi.fn();
const mockSendMessage = vi.fn();

function clientAnswers(response: unknown) {
  mockSendMessage.mockImplementation(
    (_id: string, _message: unknown, callback: (r: unknown) => void) =>
      callback(response),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockManagementGet.mockResolvedValue({ enabled: true, name: "Apty Client" });
  (global as any).chrome = {
    runtime: { id: "agent-own-id", sendMessage: mockSendMessage },
    management: { get: mockManagementGet },
  };
});

function connect() {
  render(<AptyClientPanel />);
  fireEvent.change(screen.getByLabelText("Extension ID"), {
    target: { value: CLIENT_ID },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
}

describe("AptyClientPanel", () => {
  it("shows this Agent's own extension ID for the Client team", () => {
    render(<AptyClientPanel />);

    expect(screen.getByText("agent-own-id")).toBeInTheDocument();
  });

  it("reports the Client as answering only after a real handshake", async () => {
    clientAnswers({ running: true });

    connect();

    expect(await screen.findByText("Answering")).toBeInTheDocument();
    expect(mockUpdateConfig).toHaveBeenCalledWith({
      clientExtensionId: CLIENT_ID,
    });
  });

  it("saves the ID but explains why an installed Client is not answering", async () => {
    clientAnswers(undefined);

    connect();

    expect(
      await screen.findByText("Installed, but not answering the Agent."),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not implement/)).toBeInTheDocument();
    expect(mockUpdateConfig).toHaveBeenCalled();
  });

  it("still runs the handshake when it may not list extensions", async () => {
    (global as any).chrome.management = undefined;
    clientAnswers({ running: true });

    connect();

    expect(await screen.findByText("Answering")).toBeInTheDocument();
  });

  it("detects installed Apty extensions after asking for permission", async () => {
    (global as any).chrome.permissions = {
      request: vi.fn().mockResolvedValue(true),
    };
    (global as any).chrome.management.getAll = vi.fn().mockResolvedValue([
      { id: CLIENT_ID, name: "Apty Client", type: "extension", enabled: true },
      {
        id: "agent-own-id",
        name: "Apty Agent",
        type: "extension",
        enabled: true,
      },
      { id: "b".repeat(32), name: "Other", type: "extension", enabled: true },
    ]);
    render(<AptyClientPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Detect" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Use Apty Client/ }),
    );

    expect(screen.getByLabelText("Extension ID")).toHaveValue(CLIENT_ID);
    expect(screen.queryByRole("button", { name: /Use Apty Agent/ })).toBeNull();
  });

  it("does not save an ID that is not installed", async () => {
    mockManagementGet.mockRejectedValue(new Error("not found"));

    connect();

    expect(await screen.findByText(/could not be found/)).toBeInTheDocument();
    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
