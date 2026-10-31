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

import {
  getRedactionMode,
  resetRedactionModeForTests,
} from "../../runtime/redaction-mode";
import {
  daptyEvidenceFromCalls,
  daptyEvidenceFromDom,
  daptyKindOf,
  MAX_TURN_CHARS,
  MAX_TURNS,
} from "./dapty-parse";
import type { RawDaptyCall } from "./dapty-types";

const CHAT =
  "https://api.app.apty.ai/ai-service/api/v1/ai/tenant-7/widget/chat?applicationId=0a000000-0000-7000-8000-000000000001";
const STORED =
  "https://cdn.apty.example/tenant-7/app-1/users/u-9/widget-chat/0197aaaa-0000-7000-8000-000000000001.json?timestamp=5";

function chat(overrides: Partial<RawDaptyCall> = {}): RawDaptyCall {
  return {
    source: "page",
    kind: "chat",
    url: CHAT,
    method: "POST",
    status: 200,
    timestamp: 100,
    ...overrides,
  };
}

const request = (message: string, context: unknown[] = []) =>
  JSON.stringify({ message, context, envId: "e", applicationType: "GENERIC" });

const answer = (reply: string, suggestions: unknown[] = []) =>
  JSON.stringify({ reply, suggestions, title: "t" });

beforeEach(async () => {
  settings.value = { redactionMode: "strict" };
  resetRedactionModeForTests();
  await getRedactionMode();
});

describe("daptyKindOf", () => {
  it("names the chat POST, its stream, a stored chat and the chat list, and nothing else", () => {
    expect(daptyKindOf(CHAT, "POST")).toBe("chat");
    expect(
      daptyKindOf(CHAT.replace("/widget/chat", "/widget/chat/stream"), "post"),
    ).toBe("chat");
    expect(daptyKindOf(STORED, "GET")).toBe("stored-chat");
    expect(
      daptyKindOf(STORED.replace(/[^/]+\.json/, "chat-list.json"), "GET"),
    ).toBe("chat-list");

    expect(daptyKindOf(CHAT, "GET")).toBeUndefined();
    expect(daptyKindOf(STORED, "PUT")).toBeUndefined();
    expect(
      daptyKindOf("https://crm.example.com/api/widget/chat", "POST"),
    ).toBeUndefined();
    expect(daptyKindOf("not a url", "POST")).toBeUndefined();
  });
});

describe("daptyEvidenceFromCalls", () => {
  it("reads the whole conversation from a chat call's context, question and answer", () => {
    const evidence = daptyEvidenceFromCalls(
      [
        chat({
          requestBody: request("How do I create a lead?", [
            { role: "user", content: "hi" },
            { role: "assistant", content: "Hello, I am Dapty" },
          ]),
          responseBody: answer("Use the Create a lead workflow.", [
            { id: "0c01", name: "Create a lead", type: "workflow" },
          ]),
        }),
      ],
      "page",
    );

    expect(evidence.turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "hi"],
      ["assistant", "Hello, I am Dapty"],
      ["user", "How do I create a lead?"],
      ["assistant", "Use the Create a lead workflow."],
    ]);
    expect(evidence.turns[3]?.suggestions).toEqual([
      { id: "0c01", name: "Create a lead", type: "workflow" },
    ]);
    expect(evidence.lastCall).toEqual({
      status: 200,
      tenantId: "tenant-7",
      applicationId: "0a000000-0000-7000-8000-000000000001",
      mode: "injected",
      timestamp: 100,
    });
    expect(evidence).toMatchObject({ calls: 1, suggestionIds: true });
  });

  it("masks what the user typed and cuts long text", () => {
    const evidence = daptyEvidenceFromCalls(
      [
        chat({
          requestBody: request(
            `Reach me at jane.doe@example.com ${"x".repeat(MAX_TURN_CHARS)}`,
          ),
        }),
      ],
      "page",
    );
    const asked = evidence.turns[0]?.text ?? "";

    expect(asked).not.toContain("jane.doe@example.com");
    expect(asked.length).toBeLessThanOrEqual(MAX_TURN_CHARS + 1);
    expect(asked.endsWith("…")).toBe(true);
  });

  it("keeps the newest turns of a long conversation", () => {
    const context = Array.from({ length: MAX_TURNS + 10 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `turn ${i}`,
    }));
    const evidence = daptyEvidenceFromCalls(
      [chat({ requestBody: request("last", context) })],
      "page",
    );

    expect(evidence.turns).toHaveLength(MAX_TURNS);
    expect(evidence.turns.at(-1)?.text).toBe("last");
  });

  it("without a request, takes the stored chat and the answers that came after it", () => {
    const stored = JSON.stringify({
      id: "c1",
      name: "Leads",
      messages: [
        { id: "m0", role: "user", content: "Where are leads?" },
        {
          id: "m1",
          role: "assistant",
          content: "Open Leads.",
          suggestions: [
            { id: "0c05", name: "Export a report", type: "workflow" },
          ],
        },
      ],
    });
    const evidence = daptyEvidenceFromCalls(
      [
        chat({ timestamp: 50, responseBody: answer("older, already stored") }),
        {
          source: "client",
          kind: "stored-chat",
          url: STORED,
          method: "GET",
          status: 200,
          responseBody: stored,
          timestamp: 60,
        },
        chat({ timestamp: 70, responseBody: answer("A newer answer.") }),
      ],
      "client",
    );

    expect(evidence.turns.map((t) => t.text)).toEqual([
      "Where are leads?",
      "Open Leads.",
      "A newer answer.",
    ]);
    expect(evidence.turns[1]?.suggestions[0]?.id).toBe("0c05");
    expect(evidence).toMatchObject({ calls: 2, storedChats: 1 });
  });

  it("reads the stream variant's done and suggestions frames", () => {
    const body = [
      'data: {"type":"token","content":"Use"}',
      'data: {"type":"done","reply":"Use the Create a lead workflow."}',
      'data: {"type":"suggestions","suggestions":[{"id":"0c01","name":"Create a lead","type":"workflow"}]}',
    ].join("\n\n");
    const evidence = daptyEvidenceFromCalls(
      [chat({ responseBody: body })],
      "page",
    );

    expect(evidence.turns).toEqual([
      {
        role: "assistant",
        text: "Use the Create a lead workflow.",
        suggestions: [{ id: "0c01", name: "Create a lead", type: "workflow" }],
      },
    ]);
  });

  it("drops suggestions without a name or a known type", () => {
    const evidence = daptyEvidenceFromCalls(
      [
        chat({
          responseBody: answer("ok", [
            { id: "a", type: "workflow" },
            { id: "b", name: "Video", type: "video" },
            { name: "No id", type: "knowledge_content" },
          ]),
        }),
      ],
      "page",
    );

    expect(evidence.turns[0]?.suggestions).toEqual([
      { name: "No id", type: "knowledge_content" },
    ]);
  });

  it("names a failed call's error without its URL, and who made the call", () => {
    const failed = chat({
      status: undefined,
      failed: true,
      errorText: `net::ERR_FAILED loading ${CHAT}`,
    });

    expect(daptyEvidenceFromCalls([failed], "page").lastCall?.errorText).toBe(
      "net::ERR_FAILED loading [url]",
    );
    expect(
      daptyEvidenceFromCalls([{ ...failed, source: "client" }], "client")
        .lastCall?.mode,
    ).toBe("extension");
    expect(
      daptyEvidenceFromCalls(
        [{ ...failed, source: "har", origin: "chrome-extension://abc" }],
        "har",
      ).lastCall?.mode,
    ).toBe("extension");
    expect(
      daptyEvidenceFromCalls(
        [{ ...failed, source: "har", origin: "https://crm.example.com" }],
        "har",
      ).lastCall?.mode,
    ).toBe("injected");
    expect(
      daptyEvidenceFromCalls([{ ...failed, source: "har" }], "har").lastCall
        ?.mode,
    ).toBeUndefined();
  });
});

describe("daptyEvidenceFromDom", () => {
  it("keeps the chat panel's turns with suggestion names and no ids", () => {
    const evidence = daptyEvidenceFromDom([
      { role: "user", text: "help", suggestionNames: [] },
      {
        role: "assistant",
        text: "Try this",
        suggestionNames: ["Create a lead", " "],
      },
      { role: "error", text: "Something went wrong", suggestionNames: [] },
      { role: "assistant", text: "   ", suggestionNames: [] },
    ]);

    expect(evidence.turns).toEqual([
      { role: "user", text: "help", suggestions: [] },
      {
        role: "assistant",
        text: "Try this",
        suggestions: [{ name: "Create a lead" }],
      },
      { role: "error", text: "Something went wrong", suggestions: [] },
    ]);
    expect(evidence).toMatchObject({
      source: "widget-dom",
      calls: 0,
      suggestionIds: false,
    });
    expect(evidence.lastCall).toBeUndefined();
  });
});
