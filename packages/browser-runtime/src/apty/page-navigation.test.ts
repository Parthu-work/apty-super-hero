import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendFrameMessage = vi.hoisted(() => vi.fn());

vi.mock("./frame-tree.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./frame-tree.js")>()),
  sendFrameMessage: mockSendFrameMessage,
}));

import {
  getNavigationModel,
  ROUTING_EVIDENCE_UNAVAILABLE,
} from "./page-navigation";

beforeEach(() => {
  mockSendFrameMessage.mockReset();
});

describe("getNavigationModel", () => {
  it("reports observed routing when the page-world hooks answered", async () => {
    mockSendFrameMessage.mockResolvedValue({
      success: true,
      data: {
        usesHistoryApiRouting: true,
        historyApiCallCount: 4,
        pushStateCount: 3,
        historyHooksSeen: true,
      },
    });

    await expect(getNavigationModel(7)).resolves.toEqual({
      usesHistoryApiRouting: true,
      historyApiCallCount: 4,
      routingEvidence: "observed",
    });
  });

  it("says routing could not be measured where the hooks don't run, rather than 'no routing'", async () => {
    mockSendFrameMessage.mockResolvedValue({
      success: true,
      data: {
        usesHistoryApiRouting: false,
        historyApiCallCount: 0,
        pushStateCount: 0,
        historyHooksSeen: false,
      },
    });

    await expect(getNavigationModel(7)).resolves.toEqual({
      usesHistoryApiRouting: false,
      historyApiCallCount: 0,
      routingEvidence: "unavailable",
      routingEvidenceReason: ROUTING_EVIDENCE_UNAVAILABLE,
    });
    expect(ROUTING_EVIDENCE_UNAVAILABLE).toMatch(/Settings → Troubleshooting/);
  });

  it("says why when the top frame does not answer", async () => {
    mockSendFrameMessage.mockResolvedValue({ success: false, error: "gone" });
    await expect(getNavigationModel(7)).resolves.toMatchObject({
      routingEvidence: "unavailable",
      routingEvidenceReason: "The page's top frame did not answer.",
    });
  });
});
