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
  tabs: { get: vi.fn(async () => ({ url: PAGE })) },
};

import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import { type AptyPage, createCdnResourceSource } from "../apty-cdn-source";
import {
  buildDaptyEvidenceBundle,
  createDaptyTrace,
  summarizeDaptyTrace,
} from "./dapty-evidence";
import { createDaptySource } from "./dapty-sources";
import type { DaptyEvidence, RawDaptyCall } from "./dapty-types";
import { capture, evidenceFrom } from "./diagnosis-test-utils";
import { createDiagnosisResponder } from "./responder";
import type { ClientEvidence, DiagnosisResult } from "./types";

const CDN = "https://client.apty.example";
const TENANT = "0f000000-0000-7000-8000-000000000000";
const APP = "0a000000-0000-7000-8000-000000000001";
const ENV = "0e000000-0000-7000-8000-000000000002";
const USER = "jane-7731";
const EMAIL = "jane.doe@example.com";
const CHAT_ID = "0197aaaa-0000-7000-8000-000000000002";
const PAGE = "https://uat.crm.example.com/leads/42";
const APP_PATH = `${CDN}/tenant-${TENANT}/app-${APP}`;

const files = capture() as Record<string, unknown>;
const appData = files["app-data.json"] as { config: Record<string, unknown> };
const routes: Record<string, unknown> = {
  [`${CDN}/tenant-${TENANT}/app-urls.json`]: [
    {
      id: APP,
      environments: [
        { id: "prod", order: 1, urls: ["https://crm.example.com/*"] },
        { id: ENV, order: 2, urls: ["https://uat.crm.example.com/*", "*"] },
      ],
    },
  ],
  [`${APP_PATH}/app-data.json`]: {
    ...appData,
    config: {
      ...appData.config,
      widgetConfig: {
        ...(appData.config.widgetConfig as Record<string, unknown>),
        features: { aiAssistant: true },
      },
      userIdentificationConfig: { type: "WindowStorage", value: "crm.user" },
    },
  },
  [`${APP_PATH}/users/${USER}/widget-chat/chat-list.json`]: {
    chats: [{ id: CHAT_ID, name: "Reports", lastUpdate: "2026-10-31" }],
  },
  [`${APP_PATH}/users/${USER}/widget-chat/${CHAT_ID}.json`]: {
    id: CHAT_ID,
    name: `Reports for ${EMAIL}`,
    messages: [
      { id: "m1", role: "user", content: `Export my pipeline? I am ${EMAIL}` },
      {
        id: "m2",
        role: "assistant",
        content: `Try these, ${EMAIL}.`,
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
      },
    ],
  },
  ...Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name !== "app-data.json")
      .map(([name, json]) => [`${APP_PATH}/env-${ENV}/${name}`, json]),
  ),
};

const fetchImpl = (async (input: RequestInfo | URL) => {
  const path = String(input).replace(/\?timestamp=\d+$/, "");
  return path in routes
    ? new Response(JSON.stringify(routes[path]), { status: 200 })
    : new Response("missing", { status: 404 });
}) as typeof fetch;

const page: AptyPage = {
  probe: async () => ({
    ok: true,
    config: {
      mode: "extension",
      contentURL: CDN,
      tenantId: TENANT,
      pageUrl: PAGE,
      clientExtensionId: "p".repeat(32),
    },
  }),
  userValue: async () => USER,
};

const noClient: ClientEvidence = {
  connection: { ok: false, failure: "no_receiver", message: "no Client" },
  observedNames: [],
  files: {},
};

/** The chat answered by the check with no Client that reports, from Apty's content CDN. */
async function runCheck(): Promise<DiagnosisResult> {
  const source = createDaptySource({
    client: async () => ({
      source: "client",
      connection: noClient.connection,
      turns: [],
      calls: 0,
      storedChats: 0,
      suggestionIds: true,
    }),
    clientFiles: async () => noClient,
    detectClient: async () => "p".repeat(32),
    clientAnswers: async () => false,
    cdn: (_tab, names, options) =>
      createCdnResourceSource({ page, files: names, fetchImpl, ...options }),
    widgetTurns: async () => ({ ok: false, reason: "no-widget" }),
  });
  const respond = createDiagnosisResponder({
    clientExtensionId: async () => undefined,
    pageUrlOf: async () => PAGE,
    daptyOf: source.chat,
    daptyFilesOf: source.files,
  });
  const answer = await respond("Dapty suggested a workflow but nothing opens", {
    runContext: { tabId: 3 },
  });
  return answer?.result as DiagnosisResult;
}

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("the Ask Dapty evidence bundle", () => {
  it("records which source answered, why the earlier ones did not, and the shape of every file", async () => {
    const result = await runCheck();
    const evidence = result.daptyEvidence;

    expect(evidence).toMatchObject({
      answeredBy: "cdn",
      clientPing: "silent",
      filesConnection: "no_receiver",
      filesFromCdn: true,
      cdnAllowed: true,
      cdnProbe: "ok",
      storedChat: "read",
      storedChatFile: {
        messages: 2,
        suggestionFields: ["id", "name", "type"],
      },
    });
    expect(evidence?.attempts.map((a) => [a.source, a.used])).toEqual([
      ["client", false],
      ["cdn", true],
    ]);
    expect(evidence?.attempts[0]?.reason).toBe("no_receiver");
    const byName = Object.fromEntries(
      (evidence?.files ?? []).map((f) => [f.name, f]),
    );
    expect(byName["app-urls.json"]).toMatchObject({
      scope: "tenant",
      apps: 1,
      environments: 2,
      patternShapes: { scheme: 2, wildcard: 3, noScheme: 1 },
    });
    expect(byName["app-data.json"]).toMatchObject({
      scope: "app",
      userIdentificationType: "WindowStorage",
      aiAssistant: true,
    });
    expect(byName["workflow.json"]).toMatchObject({
      scope: "env",
      status: "ok",
      suggestionIdMatches: ["sourceId", "none"],
    });
    expect(byName["workflow.json"]?.items).toBeGreaterThan(0);
    expect(evidence?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("holds no URL, email, tenant, application, user or chat id in Strict", async () => {
    const bundle = buildDaptyEvidenceBundle({
      result: await runCheck(),
      versions: { agent: "0.1.0", commit: "abc1234", chrome: "130.0.0.0" },
      generatedAt: new Date("2026-11-03T00:00:00Z"),
    });
    const json = JSON.stringify(bundle);

    expect(bundle).toMatchObject({
      bundleVersion: "apty-dapty-evidence/1",
      versions: { agent: "0.1.0", commit: "abc1234" },
      result: { packId: "dapty-conversation" },
    });
    expect(bundle.evidence?.answeredBy).toBe("cdn");
    expect(json).not.toMatch(/https?:\/\//);
    for (const secret of [
      "example.com",
      "apty.example",
      EMAIL,
      USER,
      TENANT,
      APP,
      ENV,
      CHAT_ID,
      "crm.user",
      "Export my pipeline",
    ]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it("summarizes the chat call and the chat panel's markers, with no text", () => {
    const trace = createDaptyTrace(0);
    const chat: RawDaptyCall = {
      source: "page",
      kind: "chat",
      url: "https://api.app.apty.ai/ai-service/api/v1/ai/t/widget/chat",
      method: "POST",
      status: 502,
      requestBody: JSON.stringify({
        message: "secret question",
        context: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
        ],
      }),
      responseBody: JSON.stringify({ error: "Bad gateway" }),
      timestamp: 2,
    };
    trace.calls.push(chat);
    trace.dom = {
      ok: true,
      turns: [
        { role: "user", text: "secret question", suggestionNames: [] },
        {
          role: "assistant",
          text: "secret answer",
          suggestionNames: ["Export a report"],
        },
      ],
    };
    const evidence: DaptyEvidence = {
      source: "widget-dom",
      connection: { ok: true },
      turns: [],
      calls: 0,
      storedChats: 0,
      suggestionIds: false,
    };

    const summary = summarizeDaptyTrace(
      trace,
      evidence,
      evidenceFrom(capture()),
      40,
    );

    expect(summary.totalMs).toBe(40);
    expect(summary.chatCall).toEqual({
      status: 502,
      requestContextLength: 2,
      responseKeys: ["error"],
      suggestionCount: 0,
    });
    expect(summary.chatPanel).toEqual({
      read: true,
      markers: [
        'data-chat-dialog="show.feedback"',
        ".MuiTypography-body2",
        ".MuiButton-root",
      ],
      turns: { user: 1, assistant: 1, error: 0 },
    });
    expect(JSON.stringify(summary)).not.toContain("secret");
    expect(JSON.stringify(summary)).not.toContain("Export a report");
  });
});
