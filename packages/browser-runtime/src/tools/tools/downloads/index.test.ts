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

import { resetApprovalStateForTests } from "../../approval";
import { answerApprovals } from "../../approval-test-utils";
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
  it("never downloads without a human decision", async () => {
    const result = (await downloadImageTool.invoke(
      { context: { conversationId: "conv-dl-gate" } } as any,
      JSON.stringify({ imageData: SAMPLE_IMAGE }),
    )) as any;

    expect(result.status).toBe("denied");
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("downloads once the user clicks Allow", async () => {
    answerApprovals({ approved: true });

    const result = (await downloadImageTool.invoke(
      { context: { conversationId: "conv-dl-1" } } as any,
      JSON.stringify({ imageData: SAMPLE_IMAGE, filename: "my-image" }),
    )) as any;

    expect(result.success).toBe(true);
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it("denying never downloads", async () => {
    answerApprovals({ approved: false });

    const result = (await downloadImageTool.invoke(
      { context: { conversationId: "conv-dl-deny" } } as any,
      JSON.stringify({ imageData: SAMPLE_IMAGE }),
    )) as any;

    expect(result).toMatchObject({ status: "denied", reason: "user_denied" });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("re-prompts on every call even when asked to remember — no page origin to scope a grant to", async () => {
    const { requests } = answerApprovals({ approved: true, remember: true });

    for (let i = 0; i < 2; i++) {
      await downloadImageTool.invoke(
        { context: { conversationId: "conv-dl-repeat" } } as any,
        JSON.stringify({ imageData: SAMPLE_IMAGE }),
      );
    }

    expect(requests).toHaveLength(2);
    expect(mockDownload).toHaveBeenCalledTimes(2);
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

  it("never downloads without a human decision", async () => {
    const result = (await downloadChatImagesTool.invoke(
      { context: { conversationId: "conv-batch-gate" } } as any,
      JSON.stringify({ messages }),
    )) as any;

    expect(result.status).toBe("denied");
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("downloads every image in the batch once approved", async () => {
    answerApprovals({ approved: true });

    const result = (await downloadChatImagesTool.invoke(
      { context: { conversationId: "conv-batch-1" } } as any,
      JSON.stringify({ messages }),
    )) as any;

    expect(result.downloadedCount).toBe(2);
    expect(mockDownload).toHaveBeenCalledTimes(2);
  });
});
