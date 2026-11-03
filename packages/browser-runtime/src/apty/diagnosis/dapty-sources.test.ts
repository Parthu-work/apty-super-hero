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
import type { CdnResourceSource, StoredChatState } from "../apty-cdn-source";
import type { AptyObservedResource } from "../types";
import { createDaptySource } from "./dapty-sources";
import type { DaptyEvidence, RawDaptyCall } from "./dapty-types";
import type { ClientEvidence } from "./types";

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
    const read = createDaptySource({
      pageCalls,
      client,
      widgetTurns: panel,
    }).chat;

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
    }).chat;
    const withPanel = createDaptySource({
      pageCalls: async () => [],
      client: async () => recorded(0),
      widgetTurns: panel,
    }).chat;

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
    }).chat;

    const evidence = await read({ tabId: 4 }, "ext");

    expect(evidence.source).toBe("client");
    expect(evidence.turns).toEqual([]);
  });

  it("reads only the Client's record when there is no tab", async () => {
    const pageCalls = vi.fn(async () => [pageCall]);
    const read = createDaptySource({
      pageCalls,
      client: async () => recorded(0),
    }).chat;

    const evidence = await read(undefined, undefined);

    expect(pageCalls).not.toHaveBeenCalled();
    expect(evidence.source).toBe("client");
  });
  it("takes the Widget's own conversation, with ids, and the recorded call's outcome", async () => {
    const read = createDaptySource({
      pageCalls: async () => [],
      client: async () => ({
        ...recorded(0),
        calls: 1,
        lastCall: { status: 503, timestamp: 9 },
      }),
      widgetChat: async () => ({
        ok: true as const,
        chats: [
          {
            chatId: "old",
            name: "Old",
            turns: [{ role: "user" as const, text: "old" }],
          },
          {
            chatId: "new",
            name: "Reports",
            turns: [
              { role: "system" as const, text: "ignored" },
              {
                role: "user" as const,
                text: "Where are reports? jane.doe@example.com",
              },
              {
                role: "assistant" as const,
                text: "Try this.",
                suggestions: [
                  { id: "0c05", name: "Export a report", type: "workflow" },
                ],
              },
            ],
          },
        ],
      }),
      widgetTurns: panel,
    }).chat;

    const evidence = await read({ tabId: 4 }, "ext");

    expect(evidence.source).toBe("client");
    expect(evidence.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(evidence.turns[0]?.text).not.toContain("jane.doe@example.com");
    expect(evidence.turns[1]?.suggestions).toEqual([
      { id: "0c05", name: "Export a report", type: "workflow" },
    ]);
    expect(evidence.lastCall?.status).toBe(503);
  });

  it("falls back when the Client cannot report the Widget's conversations", async () => {
    const read = createDaptySource({
      client: async () => recorded(1),
      widgetChat: async () => ({
        ok: false as const,
        failure: "no_receiver" as const,
        message: "x",
      }),
    }).chat;

    expect((await read({ tabId: 4 }, "ext")).turns[0]?.text).toBe(
      "From the Client",
    );
  });

  describe("without a Client that reports its calls", () => {
    const STORED_URL =
      "https://client.apty.example/tenant-t/app-a/users/u-7/widget-chat/c1.json";
    const WORKFLOW_URL =
      "https://client.apty.example/tenant-t/app-a/env-e/workflow.json";
    const noClient: ClientEvidence = {
      connection: { ok: false, failure: "no_receiver", message: "no Client" },
      observedNames: [],
      files: {},
    };

    function fakeCdn(
      resources: AptyObservedResource[],
      bodies: Record<string, string>,
      state: StoredChatState = "read",
    ): CdnResourceSource {
      return {
        listResources: async () => ({ ok: true, resources }),
        getResourceBody: async (id) =>
          bodies[id] !== undefined
            ? { found: true, body: bodies[id], base64Encoded: false }
            : { found: false },
        probe: async () => ({ ok: false, reason: "no-apty" }),
        storedChat: async () => state,
      };
    }

    const stored = fakeCdn(
      [
        {
          requestId: "s",
          url: STORED_URL,
          method: "GET",
          status: 200,
          timestamp: 2,
          hasBody: true,
        },
        {
          requestId: "w",
          url: WORKFLOW_URL,
          method: "GET",
          status: 200,
          timestamp: 1,
          hasBody: true,
        },
      ],
      {
        s: JSON.stringify({
          id: "c1",
          name: "Reports",
          messages: [
            { id: "1", role: "user", content: "Where are reports?" },
            {
              id: "2",
              role: "assistant",
              content: "Try this.",
              suggestions: [{ id: "0c05", name: "Export", type: "workflow" }],
            },
          ],
        }),
        w: JSON.stringify([{ name: "Export" }]),
      },
    );

    it("reads the stored chat on the CDN, with ids, before the chat panel", async () => {
      const widgetTurns = vi.fn(panel);
      const read = createDaptySource({
        client: async () => recorded(0),
        cdn: () => stored,
        widgetTurns,
      }).chat;

      const evidence = await read({ tabId: 4 }, undefined);

      expect(evidence.source).toBe("cdn");
      expect(evidence.suggestionIds).toBe(true);
      expect(evidence.turns[1]?.suggestions[0]?.id).toBe("0c05");
      expect(widgetTurns).not.toHaveBeenCalled();
    });

    it("falls back to the chat panel and says why the stored chat was not read", async () => {
      const read = createDaptySource({
        client: async () => recorded(0),
        cdn: () => fakeCdn([], {}, "apty-id"),
        widgetTurns: panel,
      }).chat;

      const evidence = await read({ tabId: 4 }, undefined);

      expect(evidence.source).toBe("widget-dom");
      expect(evidence.storedChatUnread).toBe("apty-id");
    });

    it("uses the Client ID the page shows when none is saved", async () => {
      const client = vi.fn(async () => recorded(1));
      const read = createDaptySource({
        client,
        detectClient: async () => "p".repeat(32),
      }).chat;

      await read({ tabId: 4 }, undefined);
      await read({ tabId: 4 }, "saved");

      expect(client).toHaveBeenNthCalledWith(1, "p".repeat(32), undefined);
      expect(client).toHaveBeenNthCalledWith(2, "saved", undefined);
    });

    it("asks a Client found on the page once whether it answers, and leaves out one that does not", async () => {
      const client = vi.fn(async () => recorded(0));
      const clientFiles = vi.fn(async () => noClient);
      const clientAnswers = vi.fn(async () => false);
      const source = createDaptySource({
        client,
        clientFiles,
        detectClient: async () => "p".repeat(32),
        clientAnswers,
      });

      await source.chat({ tabId: 4 }, undefined);
      await source.files({ tabId: 4 }, undefined);
      await source.chat({ tabId: 4 }, "saved");

      expect(clientAnswers).toHaveBeenCalledTimes(1);
      expect(client).toHaveBeenNthCalledWith(1, undefined, undefined);
      expect(clientFiles).toHaveBeenCalledWith(undefined, expect.any(Array));
      expect(client).toHaveBeenNthCalledWith(2, "saved", undefined);
    });

    it("reads the content files from the CDN when the Client does not answer, and shares one CDN read with the chat", async () => {
      const cdn = vi.fn(() => stored);
      const source = createDaptySource({
        client: async () => recorded(0),
        clientFiles: async () => noClient,
        cdn,
      });

      const files = await source.files({ tabId: 4 }, "ext");
      await source.chat({ tabId: 4 }, "ext");

      expect(files.fromCdn).toBe(true);
      expect(files.files["workflow.json"]?.status).toBe("ok");
      expect(cdn).toHaveBeenCalledTimes(1);
    });

    it("keeps the Client's files when it answers, and keeps the Client's reason when neither answers", async () => {
      const fromClient: ClientEvidence = {
        connection: { ok: true },
        observedNames: [],
        files: {},
      };
      const answering = createDaptySource({
        clientFiles: async () => fromClient,
        cdn: () => stored,
      });
      const neither = createDaptySource({
        clientFiles: async () => noClient,
        cdn: () => ({
          ...fakeCdn([], {}),
          listResources: async () => ({
            ok: false,
            resources: [],
            failure: "no_receiver" as const,
          }),
        }),
      });

      expect(await answering.files({ tabId: 4 }, "ext")).toBe(fromClient);
      const missing = await neither.files({ tabId: 4 }, undefined);
      expect(missing.connection).toMatchObject({
        ok: false,
        failure: "no_receiver",
        message: expect.stringContaining(
          "Apty's content CDN could not be read either",
        ),
      });
    });
  });
});
