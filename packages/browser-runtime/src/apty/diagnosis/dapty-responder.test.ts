import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";

const mockSendMessage = vi.hoisted(() => vi.fn());
const settings = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

(globalThis as { chrome?: unknown }).chrome = {
  runtime: {
    id: "bpiondflhhdplemamgggcdajclmoeple",
    sendMessage: mockSendMessage,
    lastError: undefined as { message: string } | undefined,
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: settings.value })),
    },
    onChanged: { addListener: vi.fn() },
  },
  tabs: { get: vi.fn(async () => ({ url: "https://crm.example.com/leads" })) },
};

import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import { runDiagnosisTool } from "../../tools/diagnosis";
import type { AptyObservedResource } from "../types";
import { daptyEvidenceFromDom } from "./dapty-parse";
import { capture, resourcesFor, served } from "./diagnosis-test-utils";
import { createDiagnosisResponder, RUN_DIAGNOSIS } from "./responder";
import type { DiagnosisResult } from "./types";

const CHAT =
  "https://api.app.apty.ai/ai-service/api/v1/ai/t-1/widget/chat?applicationId=0a000000-0000-7000-8000-000000000001";
const ANSWER = JSON.stringify({
  reply: "Use Export a report or Retired flow.",
  suggestions: [
    {
      id: "0c000000-0000-7000-8000-000000000005",
      name: "Export a report",
      type: "workflow",
    },
    {
      id: "0c000000-0000-7000-8000-0000000000ff",
      name: "Retired flow",
      type: "workflow",
    },
  ],
});

/** The Client's record: the content files and, in Extension mode, the chat call it made. */
function serveClient() {
  const files = served(capture());
  const resources: AptyObservedResource[] = [
    ...resourcesFor(files),
    {
      requestId: "chat-1",
      url: CHAT,
      method: "POST",
      status: 200,
      mimeType: "application/json",
      timestamp: 5000,
      hasBody: true,
    },
  ];
  mockSendMessage.mockImplementation(
    (
      _id: string,
      message: { type: string; requestId?: string },
      callback: (r: unknown) => void,
    ) => {
      if (message.type === "apty-debug-agent:list-observed-resources") {
        callback({ resources });
      } else if (message.type === "apty-debug-agent:get-resource-body") {
        if (message.requestId === "chat-1") {
          callback({ found: true, body: ANSWER });
          return;
        }
        const index = resources.findIndex(
          (r) => r.requestId === message.requestId,
        );
        callback({ found: true, body: files[index]?.body });
      } else {
        callback(undefined);
      }
    },
  );
}

beforeEach(() => {
  mockSendMessage.mockReset();
  settings.value = {
    redactionMode: "strict",
    networkBodyCaptureDenyList: [],
    clientExtensionId: EXT_ID,
  };
  resetRedactionModeForTests();
  serveClient();
});

describe("the Ask Dapty check in the chat", () => {
  it("answers a question about Dapty from the Client's record, with no model call", async () => {
    const respond = createDiagnosisResponder();

    const answer = await respond(
      "Dapty suggested a workflow but nothing opens",
      { runContext: { tabId: 7 } },
    );
    const result = answer?.result as DiagnosisResult;

    expect(answer?.toolName).toBe(RUN_DIAGNOSIS);
    expect(answer?.params).toEqual({ kind: "dapty" });
    expect(result.packId).toBe("dapty-conversation");
    expect(result.dapty?.source).toBe("client");
    expect(result.dapty?.suggestions.map((r) => [r.name, r.status])).toEqual([
      ["Export a report", "launches"],
      ["Retired flow", "missing"],
    ]);
    expect(result.verdict.causes.map((c) => c.ruleId)).toEqual(["DAP-06"]);
    expect(answer?.transcript).toContain("Ask Dapty chat check");
    expect(answer?.transcript).toContain('Suggested "Retired flow": missing');
    expect(answer?.transcript).not.toContain("KB card ;");
    expect(answer?.transcript).not.toContain("https://");
  });

  it("reads the chat from the source the extension hands it", async () => {
    const daptyOf = vi.fn(async () =>
      daptyEvidenceFromDom([
        { role: "user", text: "help", suggestionNames: [] },
        { role: "assistant", text: "Here", suggestionNames: ["Create a lead"] },
      ]),
    );
    const respond = createDiagnosisResponder({ daptyOf });

    const answer = await respond("the AI assistant is not working", {
      runContext: { tabId: 7 },
    });
    const result = answer?.result as DiagnosisResult;

    expect(daptyOf).toHaveBeenCalledWith({ tabId: 7 }, EXT_ID);
    expect(result.dapty).toMatchObject({
      source: "widget-dom",
      namesOnly: true,
    });
  });

  it("leaves a how-to question about Dapty to the model", async () => {
    const respond = createDiagnosisResponder();

    expect(await respond("How do I turn on Dapty?", {})).toBeUndefined();
  });
});

describe("run_diagnosis kind 'dapty'", () => {
  it("runs the same check for the model", async () => {
    const result = (await runDiagnosisTool.invoke(
      { context: { conversationId: "c1", tabId: 7 } } as never,
      JSON.stringify({
        kind: "dapty",
        name: null,
        problem: null,
        step: null,
        language: null,
      }),
    )) as unknown;
    const parsed = (
      typeof result === "string" ? JSON.parse(result) : result
    ) as DiagnosisResult;

    expect(parsed.packId).toBe("dapty-conversation");
    expect(parsed.verdict.causes[0]?.ruleId).toBe("DAP-06");
  });
});
