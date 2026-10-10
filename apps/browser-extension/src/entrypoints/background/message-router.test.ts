import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./downloads", () => ({ downloadChatImagesInBackground: vi.fn() }));
vi.mock("./recording", () => ({ setIsRecording: vi.fn() }));
vi.mock("./sidepanel", () => ({ openSidePanelOnDemand: vi.fn() }));

const EXTENSION_ID = "this-extension-id";
let registeredListener:
  | ((message: any, sender: any, sendResponse: (r: unknown) => void) => boolean)
  | undefined;

(global as any).chrome = {
  runtime: {
    id: EXTENSION_ID,
    onMessage: {
      addListener: (
        listener: (
          message: any,
          sender: any,
          sendResponse: (r: unknown) => void,
        ) => boolean,
      ) => {
        registeredListener = listener;
      },
    },
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
  storage: {
    local: { set: vi.fn().mockResolvedValue(undefined) },
  },
  tabs: {
    query: vi.fn((_q: unknown, cb: (tabs: unknown[]) => void) => cb([])),
  },
};

import { downloadChatImagesInBackground } from "./downloads";
import { registerMessageRouter } from "./message-router";
import { setIsRecording } from "./recording";
import { openSidePanelOnDemand } from "./sidepanel";

const TRUSTED_SENDER = {
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/src/entrypoints/sidepanel/index.html`,
};
const UNTRUSTED_SENDER = {
  id: EXTENSION_ID,
  tab: { id: 1 },
  url: "https://example.com/page",
};

function invoke(message: unknown, sender: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    registeredListener?.(message, sender, resolve);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  registeredListener = undefined;
  registerMessageRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("message-router — privileged request sender checks", () => {
  it("start-recording from a trusted extension page is accepted", async () => {
    const result = (await invoke(
      { request: "start-recording" },
      TRUSTED_SENDER,
    )) as any;
    expect(result.success).toBe(true);
    expect(setIsRecording).toHaveBeenCalledWith(true);
  });

  it("start-recording from a content script (sender.tab set) is rejected", async () => {
    const result = (await invoke(
      { request: "start-recording" },
      UNTRUSTED_SENDER,
    )) as any;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unauthorized/i);
    expect(setIsRecording).not.toHaveBeenCalled();
  });

  it("stop-recording from a content script is rejected", async () => {
    const result = (await invoke(
      { request: "stop-recording" },
      UNTRUSTED_SENDER,
    )) as any;
    expect(result.success).toBe(false);
    expect(setIsRecording).not.toHaveBeenCalledWith(false);
  });

  it("relay-to-active-tab from a content script is rejected before querying tabs", async () => {
    const result = (await invoke(
      { request: "relay-to-active-tab", message: { foo: "bar" } },
      UNTRUSTED_SENDER,
    )) as any;
    expect(result.success).toBe(false);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it("relay-to-active-tab from a trusted extension page proceeds to query tabs", async () => {
    await invoke(
      { request: "relay-to-active-tab", message: { foo: "bar" } },
      TRUSTED_SENDER,
    );
    expect(chrome.tabs.query).toHaveBeenCalled();
  });

  it("capture-click-event (not privileged) still works from a content script", async () => {
    const result = (await invoke(
      { request: "capture-click-event", data: { x: 1 } },
      UNTRUSTED_SENDER,
    )) as any;
    expect(result.success).toBe(true);
  });
});

describe("message-router — chat image downloads", () => {
  const IMAGES = [
    {
      id: "m1",
      parts: [{ type: "image", imageData: "data:image/png;base64,x" }],
    },
  ];
  const REQUEST = {
    request: "get-current-chat-images-for-download",
    folderPrefix: "shots",
    imageNames: ["login"],
  };
  const sendMessage = () =>
    (global as any).chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(downloadChatImagesInBackground).mockResolvedValue({
      success: true,
      downloadedCount: 1,
      downloadIds: [3],
      filesList: ["shots/login.png"],
    });
  });

  afterEach(() => {
    sendMessage().mockResolvedValue(undefined);
    delete (global as any).chrome.tabs.sendMessage;
  });

  it("refuses a content script before asking anyone for images or downloading", async () => {
    const result = (await invoke(REQUEST, UNTRUSTED_SENDER)) as any;

    expect(result).toEqual({ success: false, error: "Unauthorized sender" });
    expect(sendMessage()).not.toHaveBeenCalled();
    expect(downloadChatImagesInBackground).not.toHaveBeenCalled();
  });

  it("downloads the side panel's images under the requested folder and names", async () => {
    sendMessage().mockResolvedValueOnce({ images: IMAGES });

    const result = (await invoke(REQUEST, TRUSTED_SENDER)) as any;

    expect(sendMessage()).toHaveBeenCalledWith(
      expect.objectContaining({ request: "provide-current-chat-images" }),
    );
    expect(downloadChatImagesInBackground).toHaveBeenCalledWith(
      IMAGES,
      "shots",
      ["login"],
    );
    expect(result).toMatchObject({
      success: true,
      downloadedCount: 1,
      folderPath: "shots",
      filesList: ["shots/login.png"],
    });
  });

  it("says so when the chat has no images", async () => {
    sendMessage().mockResolvedValueOnce({ images: [] });
    expect(await invoke(REQUEST, TRUSTED_SENDER)).toEqual({
      success: false,
      error: "No images found in current chat",
    });
    expect(downloadChatImagesInBackground).not.toHaveBeenCalled();
  });

  it("falls back to the active tab when the side panel does not answer", async () => {
    sendMessage().mockRejectedValueOnce(new Error("no receiver"));
    (global as any).chrome.tabs.query = vi.fn(async () => [{ id: 4 }]);
    (global as any).chrome.tabs.sendMessage = vi.fn(async () => ({
      images: IMAGES,
    }));

    const result = (await invoke(REQUEST, TRUSTED_SENDER)) as any;

    expect((global as any).chrome.tabs.sendMessage).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ request: "provide-current-chat-images" }),
    );
    expect(result.success).toBe(true);
  });

  it("reports that the chat could not be reached when neither answers", async () => {
    sendMessage().mockRejectedValueOnce(new Error("no receiver"));
    (global as any).chrome.tabs.query = vi.fn(async () => []);

    expect(await invoke(REQUEST, TRUSTED_SENDER)).toEqual({
      success: false,
      error: "Unable to access current chat",
    });
  });
});

describe("message-router — other requests", () => {
  it("relays a trusted page's message to the active tab and reports a missing tab", async () => {
    (global as any).chrome.tabs.query = vi.fn(
      (_q: unknown, cb: (tabs: unknown[]) => void) => cb([{ id: 9 }]),
    );
    (global as any).chrome.tabs.sendMessage = vi.fn(async () => undefined);
    expect(
      await invoke(
        { request: "relay-to-active-tab", message: { foo: "bar" } },
        TRUSTED_SENDER,
      ),
    ).toEqual({ success: true });
    expect((global as any).chrome.tabs.sendMessage).toHaveBeenCalledWith(9, {
      foo: "bar",
    });

    (global as any).chrome.tabs.query = vi.fn(
      (_q: unknown, cb: (tabs: unknown[]) => void) => cb([]),
    );
    expect(
      await invoke(
        { request: "relay-to-active-tab", message: { foo: "bar" } },
        TRUSTED_SENDER,
      ),
    ).toEqual({ success: false, error: "No active tab" });
    delete (global as any).chrome.tabs.sendMessage;
  });

  it("re-broadcasts and stores a captured click", async () => {
    await invoke(
      { request: "capture-click-event", data: { x: 1 } },
      UNTRUSTED_SENDER,
    );
    expect((global as any).chrome.runtime.sendMessage).toHaveBeenCalledWith({
      request: "capture-click-event",
      data: { x: 1 },
    });
    expect((global as any).chrome.storage.local.set).toHaveBeenCalledWith({
      aipex_last_capture_event: { data: { x: 1 }, ts: expect.any(Number) },
    });
  });

  it("reports a side panel that could not open", async () => {
    vi.mocked(openSidePanelOnDemand).mockRejectedValueOnce(
      new Error("user gesture required"),
    );
    expect(
      await invoke({ request: "open-sidepanel" }, UNTRUSTED_SENDER),
    ).toEqual({ success: false, error: "user gesture required" });
  });

  it("leaves unknown requests to other listeners", () => {
    expect(
      registeredListener?.(
        { request: "something-else" },
        TRUSTED_SENDER,
        () => {},
      ),
    ).toBe(false);
  });
});
