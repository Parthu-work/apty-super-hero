import type { AgentInputItem } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let session: Record<string, unknown> = {};
const listeners: Array<
  (changes: Record<string, unknown>, area: string) => void
> = [];
vi.stubGlobal("chrome", {
  storage: {
    session: {
      get: vi.fn(async (key: string) => ({ [key]: session[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        session = { ...session, ...items };
      }),
    },
    onChanged: {
      addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
    },
  },
});

import {
  buildRequestReport,
  createRequestReportFilter,
  MAX_REQUEST_REPORTS,
  REQUEST_REPORTS_KEY,
  readRequestReports,
  resetRequestReportsForTests,
} from "./request-reports.js";

const SECRET_WORDS = [
  "Jane Testpatient",
  "https://ehr.example.com",
  "read_page",
];

const items = [
  { type: "message", role: "user", content: "about Jane Testpatient" },
  {
    type: "function_call",
    callId: "c1",
    name: "read_page",
    arguments: '{"url":"https://ehr.example.com/a?mrn=1"}',
  },
  {
    type: "function_call_result",
    callId: "c1",
    name: "read_page",
    output: '{"stubbed":true,"tool":"read_page","size":900,"preview":"x"}',
  },
  {
    type: "function_call_result",
    callId: "c2",
    name: "read_page",
    output: {
      type: "text",
      text: '{"a":1,"truncatedForModel":{"originalChars":9000}}',
    },
  },
  {
    type: "message",
    role: "user",
    content: [{ type: "input_image", image: "data:image/png;base64,AAAA" }],
  },
] as unknown as AgentInputItem[];

const request = {
  instructions: "x".repeat(400),
  tools: [{ name: "read_page", description: "Reads", parameters: {} }],
};

beforeEach(() => {
  session = {};
  resetRequestReportsForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildRequestReport", () => {
  it("counts and sizes the request without keeping any of its content", () => {
    const report = buildRequestReport(items, request, "strict", 1000);
    expect(report).toMatchObject({
      at: 1000,
      redactionMode: "strict",
      systemPromptTokens: 100,
      toolCount: 1,
      items: 5,
      toolResults: 2,
      toolResultsStubbed: 1,
      toolResultsCut: 1,
      images: 1,
    });
    expect(report.totalTokens).toBe(
      report.systemPromptTokens +
        report.toolSchemaTokens +
        report.historyTokens +
        report.toolResultTokens,
    );
    const stored = JSON.stringify(report);
    for (const word of SECRET_WORDS) expect(stored).not.toContain(word);
  });
});

describe("request report filter", () => {
  it("passes the items through untouched and records a report", async () => {
    const filter = createRequestReportFilter({ getMode: () => "standard" });
    const out = await filter(items, request);
    expect(out).toBe(items);
    const [report] = await readRequestReports();
    expect(report?.redactionMode).toBe("standard");
    expect(JSON.stringify(session[REQUEST_REPORTS_KEY])).not.toContain(
      "Jane Testpatient",
    );
  });

  it("keeps only the newest reports, newest first", async () => {
    vi.useFakeTimers();
    const filter = createRequestReportFilter({ getMode: () => "strict" });
    for (let i = 0; i < MAX_REQUEST_REPORTS + 3; i++) {
      vi.setSystemTime(1000 + i);
      await filter(items, request);
    }
    const reports = await readRequestReports();
    expect(MAX_REQUEST_REPORTS).toBe(5);
    expect(reports).toHaveLength(5);
    expect(reports.map((r) => r.at)).toEqual([1007, 1006, 1005, 1004, 1003]);
  });

  it("still sends the request when the report cannot be stored", async () => {
    vi.mocked(chrome.storage.session.set).mockRejectedValueOnce(
      new Error("quota"),
    );
    const filter = createRequestReportFilter({ getMode: () => "strict" });
    await expect(filter(items, request)).resolves.toBe(items);
  });
});

describe("readRequestReports", () => {
  it("is empty when nothing was sent or storage holds something else", async () => {
    expect(await readRequestReports()).toEqual([]);
    session[REQUEST_REPORTS_KEY] = "garbage";
    expect(await readRequestReports()).toEqual([]);
  });
});
