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

import { registerMessageRouter } from "./message-router";
import { setIsRecording } from "./recording";

const TRUSTED_SENDER = { id: EXTENSION_ID }; // extension's own page, no sender.tab
const UNTRUSTED_SENDER = { id: EXTENSION_ID, tab: { id: 1 } }; // a content script in some page

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
