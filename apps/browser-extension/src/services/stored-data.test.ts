import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAllConversations: vi.fn(),
  clearScreenshots: vi.fn(),
  clearAgentSessions: vi.fn(),
  clearKbVersions: vi.fn(),
}));

vi.mock("@apty/browser-runtime/conversation/conversation-storage", () => ({
  conversationStorage: { clearAllConversations: mocks.clearAllConversations },
}));
vi.mock("@apty/browser-runtime/storage/screenshot-storage", () => ({
  RuntimeScreenshotStorage: { clearAll: mocks.clearScreenshots },
}));
vi.mock("@apty/browser-runtime/storage/agent-session-store", () => ({
  clearAgentSessions: mocks.clearAgentSessions,
}));
vi.mock("@apty/browser-runtime/kb/kb-version", () => ({
  clearKbVersions: mocks.clearKbVersions,
}));

import { purgeStoredData } from "./stored-data";

describe("purgeStoredData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const fn of Object.values(mocks)) fn.mockResolvedValue(undefined);
  });

  it("clears conversations, screenshots, agent sessions and each site's Apty version", async () => {
    await purgeStoredData();

    expect(mocks.clearAllConversations).toHaveBeenCalledOnce();
    expect(mocks.clearScreenshots).toHaveBeenCalledOnce();
    expect(mocks.clearAgentSessions).toHaveBeenCalledOnce();
    expect(mocks.clearKbVersions).toHaveBeenCalledOnce();
  });

  it("fails when the agent sessions could not be cleared", async () => {
    mocks.clearAgentSessions.mockRejectedValue(new Error("blocked"));
    await expect(purgeStoredData()).rejects.toThrow();
  });
});
