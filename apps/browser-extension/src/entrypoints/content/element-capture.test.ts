import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.hoisted(() => vi.fn());
vi.hoisted(() => {
  (globalThis as any).chrome = { runtime: { sendMessage } };
});

import {
  generateCssSelector,
  startCapture,
  stopCapture,
} from "./element-capture";

beforeEach(() => {
  sendMessage.mockReset().mockResolvedValue(undefined);
  document.body.innerHTML =
    '<main><ul><li>a</li><li><button class="btn aipex-x primary">Save</button></li></ul></main>';
});

afterEach(() => {
  stopCapture();
});

describe("element capture", () => {
  it("reports the first clicked element and swallows that click", () => {
    const button = document.querySelector("button")!;
    const pageHandler = vi.fn();
    button.addEventListener("click", pageHandler);

    startCapture();
    button.click();

    expect(pageHandler).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      request: "capture-click-event",
      data: {
        tagName: "button",
        classes: ["btn", "primary"],
        textContent: "Save",
        url: window.location.href,
      },
    });
  });

  it("stops after one capture, so later clicks reach the page", () => {
    const button = document.querySelector("button")!;
    const pageHandler = vi.fn();
    button.addEventListener("click", pageHandler);

    startCapture();
    button.click();
    button.click();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(pageHandler).toHaveBeenCalledTimes(1);
  });

  it("highlights the hovered element and clears it on stop", () => {
    const button = document.querySelector("button")!;

    startCapture();
    button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(button.classList.contains("aipex-capture-highlight")).toBe(true);

    stopCapture();
    expect(button.classList.contains("aipex-capture-highlight")).toBe(false);
  });

  it("does nothing on click once stopped", () => {
    startCapture();
    stopCapture();

    document.querySelector("button")!.click();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("builds a selector that skips the Agent's own classes", () => {
    expect(generateCssSelector(document.querySelector("button")!)).toBe(
      "main > ul > li:nth-child(2) > button.btn.primary",
    );
  });
});
