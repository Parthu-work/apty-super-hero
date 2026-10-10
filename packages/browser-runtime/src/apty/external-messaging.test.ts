import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendExternalMessage,
  sendExternalMessageDetailed,
} from "./external-messaging";

const CLIENT_ID = "abcdefghijklmnopabcdefghijklmnop";
let lastError: { message: string } | undefined;
const sendMessage = vi.fn();

beforeEach(() => {
  lastError = undefined;
  sendMessage.mockReset();
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      get lastError() {
        return lastError;
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function answer(response: unknown, error?: string) {
  sendMessage.mockImplementation((_id, _message, callback) => {
    lastError = error ? { message: error } : undefined;
    callback(response);
    lastError = undefined;
  });
}

describe("sendExternalMessageDetailed", () => {
  it("sends only to the configured extension and returns its answer", async () => {
    answer({ logs: [] });
    await expect(
      sendExternalMessageDetailed(CLIENT_ID, { type: "ping" }),
    ).resolves.toEqual({ ok: true, response: { logs: [] } });
    expect(sendMessage).toHaveBeenCalledWith(
      CLIENT_ID,
      { type: "ping" },
      expect.any(Function),
    );
  });

  it.each([
    [
      "Could not establish connection. Receiving end does not exist.",
      "no_receiver",
    ],
    ["The message port closed before a response was received.", "no_response"],
    ["Invalid extension id: 'x'", "send_failed"],
  ])("classifies %j as %s", async (message, failure) => {
    answer(undefined, message);
    await expect(sendExternalMessageDetailed(CLIENT_ID, {})).resolves.toEqual({
      ok: false,
      failure,
      detail: message,
    });
  });

  it("treats an empty answer as no_response, never as success", async () => {
    answer(undefined);
    await expect(sendExternalMessageDetailed(CLIENT_ID, {})).resolves.toEqual({
      ok: false,
      failure: "no_response",
    });
  });

  it("reports a send Chrome throws on synchronously", async () => {
    sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });
    await expect(sendExternalMessageDetailed(CLIENT_ID, {})).resolves.toEqual({
      ok: false,
      failure: "send_failed",
      detail: "Extension context invalidated.",
    });
  });

  it("times out when nothing comes back, and ignores a late answer", async () => {
    vi.useFakeTimers();
    let late: ((response: unknown) => void) | undefined;
    sendMessage.mockImplementation((_id, _message, callback) => {
      late = callback;
    });

    const outcome = sendExternalMessageDetailed(CLIENT_ID, {}, 50);
    await vi.advanceTimersByTimeAsync(50);
    late?.({ too: "late" });

    await expect(outcome).resolves.toEqual({ ok: false, failure: "timeout" });
  });
});

describe("sendExternalMessage", () => {
  it("returns the answer, or undefined for any failure", async () => {
    answer("pong");
    await expect(sendExternalMessage(CLIENT_ID, {})).resolves.toBe("pong");
    answer(undefined, "Receiving end does not exist.");
    await expect(sendExternalMessage(CLIENT_ID, {})).resolves.toBeUndefined();
  });
});
