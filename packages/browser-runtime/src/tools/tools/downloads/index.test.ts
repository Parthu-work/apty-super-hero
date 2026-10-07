import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageStore: Record<string, unknown> = {};
const mockDownload = vi.fn();

(global as any).chrome = {
  downloads: {
    download: mockDownload,
  },
  storage: {
    local: {
      get: (key: string) => Promise.resolve({ [key]: storageStore[key] }),
      set: (items: Record<string, unknown>) => {
        storageStore = { ...storageStore, ...items };
        return Promise.resolve();
      },
    },
  },
};

import { confirmRiskyAction, resetApprovalStateForTests } from "../../approval";
import { downloadChatImagesTool, downloadImageTool } from "./index";

const SAMPLE_IMAGE = "data:image/png;base64,aGVsbG8=";

beforeEach(async () => {
  vi.clearAllMocks();
  storageStore = {};
  mockDownload.mockResolvedValue(1);
  await resetApprovalStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadImageTool", () => {
  it("never downloads on the first call — always returns a pending approval", async () => {
    const result = (await downloadImageTool.invoke(
      { context: { conversationId: "conv-dl-gate" } } as any,
      JSON.stringify({ imageData: SAMPLE_IMAGE }),
    )) as any;

    expect(result.status).toBe("needs_approval");
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("downloads once approved", async () => {
    const conversationId = "conv-dl-1";
    const pending = (await downloadImageTool.invoke(
      { context: { conversationId } } as any,
      JSON.stringify({ imageData: SAMPLE_IMAGE, filename: "my-image" }),
    )) as any;

    const confirmed = await confirmRiskyAction(
      conversationId,
      pending.approvalId,
      true,
    );

    expect(confirmed.executed).toBe(true);
    expect((confirmed.result as any).success).toBe(true);
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it("denying never downloads", async () => {
    const conversationId = "conv-dl-deny";
    const pending = (await downloadImageTool.invoke(
      { context: { conversationId } } as any,
      JSON.stringify({ imageData: SAMPLE_IMAGE }),
    )) as any;

    const confirmed = await confirmRiskyAction(
      conversationId,
      pending.approvalId,
      false,
    );

    expect(confirmed.denied).toBe(true);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("re-prompts on every call — no page origin to remember a grant against", async () => {
    const conversationId = "conv-dl-repeat";
    const first = (await downloadImageTool.invoke(
      { context: { conversationId } } as any,
      JSON.stringify({ imageData: SAMPLE_IMAGE }),
    )) as any;
    await confirmRiskyAction(conversationId, first.approvalId, true);

    const second = (await downloadImageTool.invoke(
      { context: { conversationId } } as any,
      JSON.stringify({ imageData: SAMPLE_IMAGE }),
    )) as any;

    expect(second.status).toBe("needs_approval");
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });
});

describe("downloadChatImagesTool", () => {
  const messages = [
    {
      id: "m1",
      parts: [
        { type: "image", imageData: SAMPLE_IMAGE, imageTitle: "First" },
        { type: "image", imageData: SAMPLE_IMAGE, imageTitle: "Second" },
      ],
    },
  ];

  it("never downloads on the first call — always returns a pending approval", async () => {
    const result = (await downloadChatImagesTool.invoke(
      { context: { conversationId: "conv-batch-gate" } } as any,
      JSON.stringify({ messages }),
    )) as any;

    expect(result.status).toBe("needs_approval");
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("downloads every image in the batch once approved", async () => {
    const conversationId = "conv-batch-1";
    const pending = (await downloadChatImagesTool.invoke(
      { context: { conversationId } } as any,
      JSON.stringify({ messages }),
    )) as any;

    const confirmed = await confirmRiskyAction(
      conversationId,
      pending.approvalId,
      true,
    );

    expect(confirmed.executed).toBe(true);
    expect((confirmed.result as any).downloadedCount).toBe(2);
    expect(mockDownload).toHaveBeenCalledTimes(2);
  });
});
