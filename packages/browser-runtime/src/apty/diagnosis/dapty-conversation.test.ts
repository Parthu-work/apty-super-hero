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
  CANNOT_ANSWER_MESSAGE,
  diagnoseDaptyConversation,
} from "./dapty-conversation";
import { daptyEvidenceFromCalls, daptyEvidenceFromDom } from "./dapty-parse";
import type { DaptyEvidence, RawDaptyCall } from "./dapty-types";
import { type Capture, capture, evidenceFrom } from "./diagnosis-test-utils";
import type { ClientEvidence } from "./types";

const APP = "0a000000-0000-7000-8000-000000000001";
const CHAT = `https://api.app.apty.ai/ai-service/api/v1/ai/t-1/widget/chat?applicationId=${APP}`;
const CREATE_A_LEAD = "0c000000-0000-7000-8000-000000000001";
const TAKE_A_TOUR = "0c000000-0000-7000-8000-000000000002";
const QUALIFY_A_LEAD = "0c000000-0000-7000-8000-000000000008";
const SALES_PLAYBOOK = "0f000000-0000-7000-8000-000000000005";

function call(overrides: Partial<RawDaptyCall> = {}): RawDaptyCall {
  return {
    source: "page",
    kind: "chat",
    url: CHAT,
    method: "POST",
    status: 200,
    requestBody: JSON.stringify({
      message: "How do I add a lead?",
      context: [],
      envId: "e",
      applicationType: "GENERIC",
    }),
    timestamp: 1,
    ...overrides,
  };
}

const reply = (text: string, suggestions: unknown[] = []) =>
  JSON.stringify({ reply: text, suggestions });

function chatWith(
  overrides: Partial<RawDaptyCall> = {},
  source: "page" | "client" | "har" = "page",
): DaptyEvidence {
  return daptyEvidenceFromCalls([call({ source, ...overrides })], source);
}

function files(change?: (c: Capture) => void): ClientEvidence {
  const c = capture();
  change?.(c);
  return evidenceFrom(c);
}

beforeEach(async () => {
  settings.value = { redactionMode: "strict" };
  resetRedactionModeForTests();
  await getRedactionMode();
});

describe("diagnoseDaptyConversation", () => {
  it("names a chat it could not read, and asks for one when none was seen", () => {
    const unreachable: DaptyEvidence = {
      source: "client",
      connection: { ok: false, failure: "no_receiver", message: "no Client" },
      turns: [],
      calls: 0,
      storedChats: 0,
      suggestionIds: true,
    };
    const none = daptyEvidenceFromCalls([], "page");

    expect(
      diagnoseDaptyConversation(unreachable, files()).verdict,
    ).toMatchObject({ status: "no_data", nextCheck: "fixConnection" });
    const result = diagnoseDaptyConversation(none, files());
    expect(result.verdict).toMatchObject({
      status: "no_data",
      nextCheck: "askDapty",
    });
    expect(result.gates[0]).toMatchObject({ reason: "daptyNotObserved" });
    expect(result.packId).toBe("dapty-conversation");
  });

  it("finds a chat turned off for the application", () => {
    const result = diagnoseDaptyConversation(
      chatWith({ responseBody: reply("Hi") }),
      files((c) => {
        const appData = c["app-data.json"] as {
          config: { widgetConfig: Record<string, unknown> };
        };
        appData.config.widgetConfig.features = { aiAssistant: false };
      }),
    );

    expect(result.verdict.causes[0]?.ruleId).toBe("DAP-01");
    expect(result.gates.find((g) => g.id === "chat-available")).toMatchObject({
      status: "fail",
      reason: "aiAssistantOff",
    });
  });

  it("leaves the switch open when app-data.json was not read", () => {
    const result = diagnoseDaptyConversation(
      chatWith({ responseBody: reply("Hi") }),
      files((c) => {
        delete c["app-data.json"];
      }),
    );

    expect(result.gates.find((g) => g.id === "chat-available")).toMatchObject({
      status: "unknown",
      reason: "appDataUnread",
    });
    expect(result.verdict.status).toBe("candidates");
  });

  it("puts a rejected origin first as the reason a page's chat call failed", () => {
    const failed = chatWith({
      status: undefined,
      failed: true,
      errorText: "net::ERR_FAILED",
    });

    const result = diagnoseDaptyConversation(
      failed,
      files(),
      "https://intranet.example.org/crm",
    );

    expect(result.verdict.causes.map((c) => c.ruleId)).toEqual([
      "DAP-04",
      "DAP-02",
    ]);
    expect(result.verdict.nextCheck).toBe("fixRequest");
    expect(result.gates.find((g) => g.id === "chat-origin")).toMatchObject({
      status: "fail",
      params: { urls: 2, withoutScheme: 0 },
    });
  });

  it("does not blame the origin when the page's origin is allowed", () => {
    const failed = chatWith({ status: undefined, failed: true });

    const result = diagnoseDaptyConversation(
      failed,
      files(),
      "https://uat.crm.example.com/leads",
    );

    expect(result.verdict.causes.map((c) => c.ruleId)).toEqual(["DAP-02"]);
    expect(result.gates.find((g) => g.id === "chat-origin")?.reason).toBe(
      "chatOriginAllowed",
    );
  });

  it("names environment URLs with no scheme, which allow no origin", () => {
    const failed = chatWith({ status: undefined, failed: true });

    const result = diagnoseDaptyConversation(
      failed,
      files((c) => {
        const apps = c["app-urls.json"] as Array<{
          environments: Array<{ urls: string[] }>;
        }>;
        for (const env of apps[0]?.environments ?? []) {
          env.urls = ["crm.example.com/*"];
        }
      }),
      "https://crm.example.com/leads",
    );
    const origin = result.verdict.causes[0];

    expect(origin).toMatchObject({
      ruleId: "DAP-04",
      params: { withoutScheme: 2, urls: 2, variant: "noScheme" },
    });
  });

  it("skips the origin in Extension mode, where no CORS check applies", () => {
    const failed = chatWith({ status: undefined, failed: true }, "client");

    const result = diagnoseDaptyConversation(
      failed,
      files(),
      "https://intranet.example.org/crm",
    );

    expect(result.verdict.causes.map((c) => c.ruleId)).toEqual(["DAP-02"]);
    expect(result.gates.find((g) => g.id === "chat-origin")?.reason).toBe(
      "chatOriginExtension",
    );
  });

  it("names an HTTP error from ai-service, and passes the origin of a call that answered", () => {
    const broken = diagnoseDaptyConversation(
      chatWith({ status: 500 }),
      files(),
      "https://intranet.example.org/crm",
    );
    const answered = diagnoseDaptyConversation(
      chatWith({ responseBody: reply("Open Leads.") }),
      files(),
      "https://intranet.example.org/crm",
    );

    expect(broken.verdict.causes[0]).toMatchObject({
      ruleId: "DAP-03",
      params: { httpStatus: 500 },
    });
    expect(answered.gates.find((g) => g.id === "chat-origin")?.reason).toBe(
      "chatOriginAnswered",
    );
  });

  it("finds Dapty's fixed give-up reply", () => {
    const result = diagnoseDaptyConversation(
      chatWith({ responseBody: reply(CANNOT_ANSWER_MESSAGE) }),
      files(),
    );

    expect(result.verdict).toMatchObject({
      status: "cause_found",
      nextCheck: "checkKb",
    });
    expect(result.verdict.causes[0]?.ruleId).toBe("DAP-05");
    expect(result.notChecked).toContain("kb-contents");
  });

  it("says what each suggestion would do on a click", () => {
    const result = diagnoseDaptyConversation(
      chatWith({
        responseBody: reply("Try these.", [
          { id: CREATE_A_LEAD, name: "Create a lead", type: "workflow" },
          { id: QUALIFY_A_LEAD, name: "Qualify a lead", type: "workflow" },
          { id: TAKE_A_TOUR, name: "Take a tour", type: "workflow" },
          {
            id: SALES_PLAYBOOK,
            name: "Sales playbook",
            type: "knowledge_content",
          },
          {
            id: "0c000000-0000-7000-8000-0000000000ff",
            name: "Retired flow",
            type: "workflow",
          },
        ]),
      }),
      files(),
    );

    expect(result.dapty?.suggestions).toEqual([
      {
        name: "Create a lead",
        type: "workflow",
        sourceId: CREATE_A_LEAD,
        status: "launches",
      },
      {
        name: "Qualify a lead",
        type: "workflow",
        sourceId: QUALIFY_A_LEAD,
        status: "rule",
        rule: "On a lead page",
      },
      // Dapty launches by id, so the widget list's flag does not stop it.
      {
        name: "Take a tour",
        type: "workflow",
        sourceId: TAKE_A_TOUR,
        status: "launches",
        listHidden: true,
      },
      {
        name: "Sales playbook",
        type: "knowledge_content",
        sourceId: SALES_PLAYBOOK,
        status: "launches",
        listHidden: true,
      },
      { name: "Retired flow", type: "workflow", status: "missing" },
    ]);
    expect(result.verdict.causes).toHaveLength(1);
    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "DAP-06",
      params: { name: "Retired flow" },
    });
    expect(result.gates.find((g) => g.id === "chat-suggestions")).toMatchObject(
      {
        status: "fail",
        params: { count: 5, missing: 1, open: 1 },
      },
    );
  });

  it("leaves a suggestion unchecked when its file was not read", () => {
    const result = diagnoseDaptyConversation(
      chatWith({
        responseBody: reply("Read this.", [
          {
            id: SALES_PLAYBOOK,
            name: "Sales playbook",
            type: "knowledge_content",
          },
        ]),
      }),
      files((c) => {
        delete c["knowledge-content.json"];
      }),
    );

    expect(result.dapty?.suggestions[0]?.status).toBe("unchecked");
    expect(result.verdict.status).toBe("candidates");
  });

  it("answers no cause when the chat answered and every suggestion opens", () => {
    const result = diagnoseDaptyConversation(
      chatWith({
        responseBody: reply("Use this.", [
          { id: CREATE_A_LEAD, name: "Create a lead", type: "workflow" },
        ]),
      }),
      files(),
    );

    expect(result.verdict.status).toBe("no_cause_in_data");
    expect(result.verdict.causes).toEqual([]);
  });

  it("asks for a member test when a suggestion depends on its visibility rule", () => {
    const result = diagnoseDaptyConversation(
      chatWith({
        responseBody: reply("Use this.", [
          { id: QUALIFY_A_LEAD, name: "Qualify a lead", type: "workflow" },
        ]),
      }),
      files(),
    );

    expect(result.verdict).toMatchObject({
      status: "candidates",
      nextCheck: "clickAsUser",
    });
  });

  it("matches the chat panel's names in both kinds of content, and names an error bubble", () => {
    const dom = daptyEvidenceFromDom([
      { role: "user", text: "help", suggestionNames: [] },
      {
        role: "assistant",
        text: "Here",
        suggestionNames: ["sales playbook", "Create a lead", "Nope"],
      },
    ]);
    const error = daptyEvidenceFromDom([
      { role: "user", text: "help", suggestionNames: [] },
      { role: "error", text: "Something went wrong", suggestionNames: [] },
    ]);

    const result = diagnoseDaptyConversation(dom, files());

    expect(
      result.dapty?.suggestions.map((r) => [r.name, r.status, r.type]),
    ).toEqual([
      ["sales playbook", "launches", "knowledge_content"],
      ["Create a lead", "launches", "workflow"],
      ["Nope", "missing", undefined],
    ]);
    expect(result.dapty?.namesOnly).toBe(true);
    expect(result.notChecked).toContain("suggestion-ids");
    expect(result.gates.find((g) => g.id === "chat-call")?.reason).toBe(
      "chatCallNotSeen",
    );
    expect(
      diagnoseDaptyConversation(error, files()).verdict.causes[0],
    ).toMatchObject({ ruleId: "DAP-03", params: { variant: "panel" } });
  });

  it("names a duplicated name as ambiguous rather than picking one", () => {
    const dom = daptyEvidenceFromDom([
      { role: "assistant", text: "Here", suggestionNames: ["Create a lead"] },
    ]);
    const result = diagnoseDaptyConversation(
      dom,
      files((c) => {
        const workflows = c["workflow.json"] as Array<Record<string, unknown>>;
        workflows.push({
          ...workflows[0],
          sourceId: "0c000000-0000-7000-8000-0000000000aa",
        });
      }),
    );

    expect(result.dapty?.suggestions[0]?.status).toBe("ambiguous");
  });

  it("keeps the last question short and masked, and no URL or id in the result", () => {
    const evidence = daptyEvidenceFromCalls(
      [
        call({
          requestBody: JSON.stringify({
            message: `Mail jane.doe@example.com about ${"lead ".repeat(80)}`,
            context: [],
          }),
          responseBody: reply("Ok"),
        }),
      ],
      "page",
    );

    const result = diagnoseDaptyConversation(evidence, files(), CHAT);
    const json = JSON.stringify(result);

    expect(result.dapty?.lastQuestion?.length).toBeLessThanOrEqual(201);
    expect(json).not.toContain("jane.doe@example.com");
    expect(json).not.toContain("https://");
    expect(json).not.toContain(APP);
  });
});
