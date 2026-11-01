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
import type { AptyResourceBody, AptyResourceList } from "../types";
import {
  type DaptyResource,
  daptyCallsFrom,
  loadDaptyFrom,
} from "./dapty-loader";
import { capture, harEntriesOf, harOf } from "./diagnosis-test-utils";
import { daptyFromHar } from "./har";
import { runHarCheck, summarizeHar } from "./har-check";

const CHAT =
  "https://api.app.apty.ai/ai-service/api/v1/ai/t-1/widget/chat?applicationId=0a000000-0000-7000-8000-000000000001";
const STORED =
  "https://cdn.apty.example/tenant-1/app-1/users/u-1/widget-chat/0197aaaa-0000-7000-8000-000000000001.json";

const question = (message: string) =>
  JSON.stringify({
    message,
    context: [],
    envId: "e",
    applicationType: "GENERIC",
  });

function source(resources: DaptyResource[], bodies: Record<string, string>) {
  const getResourceBody = vi.fn(
    async (requestId: string): Promise<AptyResourceBody> =>
      requestId in bodies
        ? { found: true, body: bodies[requestId] }
        : { found: false, reason: "none" },
  );
  return {
    listResources: async (): Promise<AptyResourceList> => ({
      ok: true,
      resources,
    }),
    getResourceBody,
  };
}

const resource = (
  requestId: string,
  url: string,
  method: string,
  timestamp: number,
  extra: Partial<DaptyResource> = {},
): DaptyResource => ({
  requestId,
  url,
  method,
  status: 200,
  mimeType: "application/json",
  timestamp,
  hasBody: true,
  ...extra,
});

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("daptyCallsFrom", () => {
  it("reads only the chat calls and stored chats, with their request and answer", async () => {
    const provider = source(
      [
        resource(
          "r1",
          "https://cdn.apty.example/tenant-1/app-1/env-1/workflow.json",
          "GET",
          1,
        ),
        resource("r2", CHAT, "POST", 2, {
          requestBody: question("Where are leads?"),
        }),
        resource("r3", STORED, "GET", 3),
      ],
      {
        r1: "[]",
        r2: JSON.stringify({ reply: "Open Leads.", suggestions: [] }),
        r3: JSON.stringify({ id: "c", name: "n", messages: [] }),
      },
    );

    const read = await daptyCallsFrom(provider, "client");

    expect(read.ok && read.calls.map((c) => [c.kind, c.timestamp])).toEqual([
      ["stored-chat", 3],
      ["chat", 2],
    ]);
    expect(read.ok && read.calls[1]).toMatchObject({
      requestBody: question("Where are leads?"),
      responseBody: JSON.stringify({ reply: "Open Leads.", suggestions: [] }),
    });
    expect(provider.getResourceBody).not.toHaveBeenCalledWith("r1");
  });

  it("masks the answer, and reads no body for a call on the deny list", async () => {
    settings.value = {
      redactionMode: "strict",
      networkBodyCaptureDenyList: ["/widget-chat/"],
    };
    resetRedactionModeForTests();
    const provider = source(
      [
        resource("r1", CHAT, "POST", 1, { requestBody: question("hi") }),
        resource("r2", STORED, "GET", 2, { requestBody: "never read" }),
      ],
      {
        r1: JSON.stringify({
          reply: "Write to jane.doe@example.com",
          suggestions: [],
        }),
        r2: JSON.stringify({ messages: [{ role: "user", content: "secret" }] }),
      },
    );

    const read = await daptyCallsFrom(provider, "client");
    if (!read.ok) throw new Error("not read");
    const [stored, chat] = read.calls;

    expect(chat?.responseBody).not.toContain("jane.doe@example.com");
    expect(stored?.responseBody).toBeUndefined();
    expect(stored?.requestBody).toBeUndefined();
    expect(provider.getResourceBody).not.toHaveBeenCalledWith("r2");
  });

  it("reads at most the 20 newest calls", async () => {
    const resources = Array.from({ length: 30 }, (_, i) =>
      resource(`r${i}`, CHAT, "POST", i),
    );

    const read = await daptyCallsFrom(source(resources, {}), "client");

    expect(read.ok && read.calls).toHaveLength(20);
    expect(read.ok && read.calls[0]?.timestamp).toBe(29);
  });

  it("names a Client that did not answer", async () => {
    const evidence = await loadDaptyFrom(
      {
        listResources: async () => ({ ok: false, failure: "no_receiver" }),
        getResourceBody: vi.fn(),
      },
      "client",
    );

    expect(evidence.connection).toMatchObject({
      ok: false,
      failure: "no_receiver",
    });
    expect(evidence.turns).toEqual([]);
  });
});

describe("the Ask Dapty chat in a HAR", () => {
  function chatEntry(
    body: unknown,
    headers: Array<{ name: string; value: string }> = [],
    status = 200,
  ) {
    return {
      startedDateTime: "2026-10-29T10:00:09.000Z",
      request: {
        method: "POST",
        url: CHAT,
        headers,
        postData: {
          mimeType: "application/json",
          text: question("Which workflow adds a lead?"),
        },
      },
      response: {
        status,
        content: {
          mimeType: "application/json",
          ...(body === undefined ? {} : { text: JSON.stringify(body) }),
        },
        ...(status === 0 ? { _error: "net::ERR_FAILED" } : {}),
      },
    };
  }

  function harWithChat(entry: ReturnType<typeof chatEntry>) {
    const har = harOf(
      harEntriesOf(capture()),
      "https://intranet.example.org/crm",
    );
    har.log.entries.push(entry as (typeof har.log.entries)[number]);
    return har;
  }

  it("reads the question from the request body and who made the call from its Origin", async () => {
    const har = harWithChat(
      chatEntry({ reply: "Use Create a lead.", suggestions: [] }, [
        { name: "Origin", value: "https://intranet.example.org" },
      ]),
    );

    const evidence = await daptyFromHar(har);

    expect(evidence.turns.map((t) => t.text)).toEqual([
      "Which workflow adds a lead?",
      "Use Create a lead.",
    ]);
    expect(evidence.lastCall?.mode).toBe("injected");
    expect(summarizeHar(har)).toMatchObject({
      daptyCalls: 1,
      daptyStoredChats: 0,
    });
  });

  it("runs the Ask Dapty check on a HAR with the page it was recorded on", async () => {
    const har = harWithChat(
      chatEntry(
        undefined,
        [{ name: "origin", value: "https://intranet.example.org" }],
        0,
      ),
    );

    const result = await runHarCheck(har, { packId: "dapty-conversation" });

    expect(result.packId).toBe("dapty-conversation");
    expect(result.dapty?.source).toBe("har");
    expect(result.verdict.causes.map((c) => c.ruleId)).toEqual([
      "DAP-04",
      "DAP-02",
    ]);
  });

  it("finds no chat in a HAR without one", async () => {
    const har = harOf(harEntriesOf(capture()));

    const result = await runHarCheck(har, { packId: "dapty-conversation" });

    expect(result.verdict).toMatchObject({
      status: "no_data",
      nextCheck: "askDapty",
    });
    expect(summarizeHar(har)).toMatchObject({ daptyCalls: 0 });
  });
});
