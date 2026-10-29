import type { FunctionTool } from "@apty/agent-core";
import { describe, expect, it, vi } from "vitest";

const listener = { addListener: () => {} };
(globalThis as { chrome?: unknown }).chrome = {
  tabs: { onActivated: listener, onUpdated: listener, onRemoved: listener },
  runtime: { onMessage: listener, sendMessage: vi.fn() },
  storage: {
    local: { get: vi.fn(async () => ({})) },
    onChanged: listener,
  },
};

const { createFileFetchResponder, routeFileRequest } = await import(
  "./file-fetch-responder.js"
);

describe("routeFileRequest", () => {
  it("takes a message that only asks for one file", () => {
    for (const [message, resourceQuery] of [
      ["get config.json", "config.json"],
      ["Get segments.json", "segments.json"],
      ["get the data from segments.json in the apty client", "segments.json"],
      ["get segments.json from the apty client again", "segments.json"],
      ["show me themes.json from the apty client", "themes.json"],
      ["Please read `rule.json`.", "rule.json"],
      ["can you fetch /api/segments.json?", "/api/segments.json"],
      ["open the raw body of “app-data.json”", "app-data.json"],
    ]) {
      expect(routeFileRequest(message as string)).toEqual({ resourceQuery });
    }
  });

  it("leaves anything more than the fetch to the model", () => {
    for (const message of [
      "get segments.json and tell me how many are inactive",
      "why is segments.json empty?",
      "what's in segments.json",
      "compare segments.json with rule.json",
      "get segments.json and rule.json",
      "get segments",
      "segments.json",
      "what did the apty client load?",
      "my workflow is not visible in the widget",
    ]) {
      expect(routeFileRequest(message)).toBeUndefined();
    }
  });
});

describe("createFileFetchResponder", () => {
  it("runs the inspect tool with the turn's run context, and keeps its result for the model", async () => {
    const result = { found: true, response: { evidenceId: "ev-1" } };
    const invoke = vi.fn(async () => result);
    const respond = createFileFetchResponder(
      () => ({ invoke }) as unknown as FunctionTool,
    );

    const answer = await respond("get segments.json", {
      runContext: { conversationId: "s-1", tabId: 3 },
    });

    expect(invoke).toHaveBeenCalledWith(
      { context: { conversationId: "s-1", tabId: 3 } },
      JSON.stringify({ resourceQuery: "segments.json" }),
    );
    expect(answer).toEqual({
      toolName: "inspect_extension_network",
      params: { resourceQuery: "segments.json" },
      result,
      transcript: JSON.stringify(result),
    });
  });

  it("does not run the tool for a message it leaves to the model", async () => {
    const invoke = vi.fn();
    const respond = createFileFetchResponder(
      () => ({ invoke }) as unknown as FunctionTool,
    );

    expect(await respond("why is segments.json empty?", {})).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the registered tool, which names a missing Client instead of guessing one", async () => {
    const answer = await createFileFetchResponder()("get config.json", {
      runContext: { conversationId: "s-2" },
    });

    expect(answer?.result).toMatchObject({
      found: false,
      status: "not_connected",
      resourceQuery: "config.json",
    });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
