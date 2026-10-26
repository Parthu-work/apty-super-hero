import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock("@apty/browser-runtime", () => ({
  getAptyIntegrationConfig: mocks.getConfig,
  updateAptyIntegrationConfig: mocks.updateConfig,
}));
vi.mock("@apty/browser-runtime/apty/service-worker-diagnostics", () => ({
  ConfiguredServiceWorkerDiagnosticsProvider: vi.fn(function provider() {
    return { getStatus: mocks.getStatus };
  }),
}));

import { connectPeer } from "./apty-client-check";

const ID = "abcdefghijklmnopabcdefghijklmnop";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getConfig.mockResolvedValue({});
  vi.stubGlobal("chrome", {
    runtime: { id: "agentidagentidagentidagentidagen" },
    management: { get: vi.fn().mockResolvedValue({ enabled: true }) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connectPeer", () => {
  it("runs the handshake, then saves the Client's ID", async () => {
    mocks.getStatus.mockResolvedValue({ status: "ok" });

    await expect(connectPeer("client", ID)).resolves.toEqual({ status: "ok" });

    expect(mocks.getStatus).toHaveBeenCalled();
    expect(mocks.updateConfig).toHaveBeenCalledWith({ clientExtensionId: ID });
  });

  it("saves Studio's ID even when it does not answer yet, so it can be fixed on Studio's side", async () => {
    mocks.getStatus.mockResolvedValue({
      status: "unavailable",
      error: "No receiver",
      peerFailure: "no_receiver",
    });

    const result = await connectPeer("studio", ID);

    expect(result).toMatchObject({
      status: "not_answering",
      message: "No receiver",
    });
    expect(mocks.updateConfig).toHaveBeenCalledWith({
      studioExtensionId: undefined,
      peers: { studio: { extensionId: ID } },
    });
  });

  it("does not save an ID when no such extension is installed", async () => {
    vi.mocked(chrome.management.get).mockRejectedValue(new Error("missing"));

    const result = await connectPeer("client", ID);

    expect(result.status).toBe("error");
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });
});
