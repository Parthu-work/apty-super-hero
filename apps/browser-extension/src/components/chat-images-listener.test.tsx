import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EXTENSION_ID = "own-extension-id";
const IMAGE = "data:image/png;base64,AAAA";

vi.mock("@apty/ui/components/chatbot/context", () => ({
  useChatContext: () => ({
    messages: [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "file", mediaType: "image/png", url: IMAGE }],
      },
    ],
  }),
}));

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (r: unknown) => void,
) => boolean;

let listener: Listener | undefined;

beforeEach(() => {
  listener = undefined;
  vi.stubGlobal("chrome", {
    runtime: {
      id: EXTENSION_ID,
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { ChatImagesListener } from "./chat-images-listener";

function ask(sender: chrome.runtime.MessageSender) {
  const sendResponse = vi.fn();
  const handled = listener?.(
    { request: "provide-current-chat-images" },
    sender,
    sendResponse,
  );
  return { handled, sendResponse };
}

describe("ChatImagesListener", () => {
  it("answers this extension's service worker", () => {
    render(<ChatImagesListener />);
    const { sendResponse } = ask({
      id: EXTENSION_ID,
      url: `chrome-extension://${EXTENSION_ID}/service-worker-loader.js`,
    });
    expect(JSON.stringify(sendResponse.mock.calls)).toContain(IMAGE);
  });

  it.each([
    [
      "a content script",
      { id: EXTENSION_ID, url: "https://evil.example/", tab: { id: 1 } },
    ],
    [
      "another extension",
      { id: "other", url: "chrome-extension://other/x.html" },
    ],
  ])("never sends chat images to %s", (_label, sender) => {
    render(<ChatImagesListener />);
    const { handled, sendResponse } = ask(
      sender as chrome.runtime.MessageSender,
    );
    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
