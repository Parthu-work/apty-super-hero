import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

(globalThis as { chrome?: unknown }).chrome = {
  runtime: { id: "agent" },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: settings.value })),
    },
    onChanged: { addListener: vi.fn() },
  },
};

import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import { createDaptySource } from "./dapty-sources";
import type { DaptyEvidence, RawDaptyCall } from "./dapty-types";

const CHAT =
  "https://api.app.apty.ai/ai-service/api/v1/ai/t/widget/chat?applicationId=a";

const pageCall: RawDaptyCall = {
  source: "page",
  kind: "chat",
  url: CHAT,
  method: "POST",
  status: 200,
  responseBody: JSON.stringify({ reply: "From the page", suggestions: [] }),
  timestamp: 1,
};

function recorded(turns: number): DaptyEvidence {
  return {
    source: "client",
    connection: { ok: true },
    turns: Array.from({ length: turns }, () => ({
      role: "assistant" as const,
      text: "From the Client",
      suggestions: [],
    })),
    calls: turns,
    storedChats: 0,
    suggestionIds: true,
  };
}

const panel = async () => ({
  ok: true as const,
  turns: [
    { role: "assistant" as const, text: "From the panel", suggestionNames: [] },
  ],
});

beforeEach(() => {
  settings.value = { redactionMode: "strict" };
  resetRedactionModeForTests();
});

describe("createDaptySource", () => {
  it("prefers the page's own calls for the conversation's tab", async () => {
    const pageCalls = vi.fn(async () => [pageCall]);
    const client = vi.fn(async () => recorded(1));
    const read = createDaptySource({ pageCalls, client, widgetTurns: panel });

    const evidence = await read({ tabId: 4 }, "ext");

    expect(pageCalls).toHaveBeenCalledWith(4);
    expect(evidence.source).toBe("page");
    expect(evidence.turns[0]?.text).toBe("From the page");
    expect(client).not.toHaveBeenCalled();
  });

  it("falls back to the Client's record, then to the chat panel", async () => {
    const withClient = createDaptySource({
      pageCalls: async () => [],
      client: async () => recorded(1),
      widgetTurns: panel,
    });
    const withPanel = createDaptySource({
      pageCalls: async () => [],
      client: async () => recorded(0),
      widgetTurns: panel,
    });

    expect((await withClient({ tabId: 4 }, "ext")).source).toBe("client");
    expect((await withPanel({ tabId: 4 }, "ext")).source).toBe("widget-dom");
  });

  it("treats a reader that throws as holding nothing", async () => {
    const read = createDaptySource({
      pageCalls: async () => {
        throw new Error("no capture");
      },
      client: async () => recorded(0),
      widgetTurns: async () => {
        throw new Error("no access");
      },
    });

    const evidence = await read({ tabId: 4 }, "ext");

    expect(evidence.source).toBe("client");
    expect(evidence.turns).toEqual([]);
  });

  it("reads only the Client's record when there is no tab", async () => {
    const pageCalls = vi.fn(async () => [pageCall]);
    const read = createDaptySource({
      pageCalls,
      client: async () => recorded(0),
    });

    const evidence = await read(undefined, undefined);

    expect(pageCalls).not.toHaveBeenCalled();
    expect(evidence.source).toBe("client");
  });
});
