import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const ATTACKER_ID = "p".repeat(32);

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockTabsGet = vi.hoisted(() => vi.fn());
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
  tabs: { get: mockTabsGet },
};

import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import { runDiagnosisTool } from "../../tools/diagnosis";
import { capture, resourcesFor, served } from "./diagnosis-test-utils";
import {
  createDiagnosisResponder,
  RUN_DIAGNOSIS,
  tabUrlOf,
  transcriptOf,
} from "./responder";
import type { DiagnosisResult } from "./types";

function serveCapture() {
  const files = served(capture());
  const resources = resourcesFor(files);
  mockSendMessage.mockImplementation(
    (
      _id: string,
      message: { type: string; requestId?: string },
      callback: (r: unknown) => void,
    ) => {
      if (message.type === "apty-debug-agent:list-observed-resources") {
        callback({ resources });
      } else if (message.type === "apty-debug-agent:get-resource-body") {
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
  serveCapture();
});

describe("createDiagnosisResponder", () => {
  it("answers a visibility question from the Client's files", async () => {
    const respond = createDiagnosisResponder();

    const answer = await respond(
      "My workflow 'Take a tour' is not visible in the widget",
      {},
    );

    expect(answer?.toolName).toBe(RUN_DIAGNOSIS);
    expect(answer?.params).toEqual({ kind: "workflow", name: "Take a tour" });
    const result = answer?.result as DiagnosisResult;
    expect(result.verdict.causes[0]?.ruleId).toBe("CNV-03");
    expect(answer?.transcript).toContain("CNV-03");
    expect(mockSendMessage.mock.calls.every((c) => c[0] === EXT_ID)).toBe(true);
  });

  it("leaves anything it does not recognise to the model, without contacting the Client", async () => {
    const respond = createDiagnosisResponder();

    expect(await respond("How do I publish a workflow?", {})).toBeUndefined();
    expect(await respond("get segments.json", {})).toBeUndefined();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("answers a widget question for the page open in the conversation's tab, without putting its URL in the answer", async () => {
    const pageUrlOf = vi.fn(async () => "https://intranet.other.example/home");
    const respond = createDiagnosisResponder({ pageUrlOf });

    const answer = await respond("the Apty widget is not appearing", {
      runContext: { conversationId: "s-1", tabId: 4 },
    });

    expect(pageUrlOf).toHaveBeenCalledWith({ conversationId: "s-1", tabId: 4 });
    expect(answer?.params).toEqual({ kind: "widget" });
    const result = answer?.result as DiagnosisResult;
    expect(result.packId).toBe("widget-not-visible");
    expect(result.verdict.causes[0]?.ruleId).toBe("WNV-02");
    expect(answer?.transcript).toMatch(/^Widget visibility check from/);
    expect(JSON.stringify(answer)).not.toContain("intranet.other.example");
  });

  it("answers a logs question from the Client and the page console of the conversation's tab", async () => {
    const pageConsoleOf = vi.fn(async () => ({
      ok: true as const,
      lines: [{ level: "debug", message: "No active application found" }],
      framesRead: 1,
      framesDisabled: 0,
    }));
    const respond = createDiagnosisResponder({ pageConsoleOf });

    const answer = await respond("any errors in the console?", {
      runContext: { conversationId: "s-3", tabId: 6 },
    });

    expect(pageConsoleOf).toHaveBeenCalledWith({
      conversationId: "s-3",
      tabId: 6,
    });
    expect(answer?.params).toEqual({ kind: "logs" });
    const result = answer?.result as DiagnosisResult;
    expect(result.packId).toBe("logs-and-errors");
    expect(result.verdict.causes[0]?.ruleId).toBe("LOG-01");
    expect(answer?.transcript).toMatch(/^Logs and errors check from/);
  });

  it("passes the language the message named to the check", async () => {
    const answer = await createDiagnosisResponder()(
      "the Create a lead workflow is not showing for French users",
      {},
    );

    expect(answer?.params).toEqual({
      kind: "workflow",
      name: "Create a lead",
      language: "fr",
    });
    expect((answer?.result as DiagnosisResult).verdict.causes[0]?.ruleId).toBe(
      "CNV-13",
    );
    expect(answer?.transcript).toContain(
      'Visibility check of workflow "Create a lead" for French users',
    );
  });

  it("runs an item's stored selector in the conversation's tab, and keeps the selector out of the answer", async () => {
    const probe = vi.fn(async () => ({
      ok: true as const,
      frames: [
        {
          depth: 0,
          sameOriginAsTop: true,
          answered: true,
          test: {
            invalid: false,
            matchCount: 2,
            renderedCount: 2,
            brokenHostIndex: null,
            shadowMatches: 0,
            chosen: { rendered: true, inViewport: true },
          },
        },
      ],
    }));
    const elementProbeOf = vi.fn(() => probe);
    const respond = createDiagnosisResponder({ elementProbeOf });

    const answer = await respond(
      "the 'Lead source help' tooltip is on the wrong element",
      { runContext: { conversationId: "s-4", tabId: 7 } },
    );

    expect(elementProbeOf).toHaveBeenCalledWith({
      conversationId: "s-4",
      tabId: 7,
    });
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ selector: 'select[name="lead_source"]' }),
    );
    expect(answer?.params).toEqual({
      kind: "tooltip",
      problem: "element-not-found",
      name: "Lead source help",
    });
    const result = answer?.result as DiagnosisResult;
    expect(result.verdict.causes[0]?.ruleId).toBe("SEL-08");
    expect(answer?.transcript).toMatch(
      /^Selector check of tooltip "Lead source help" from the Apty Client's files/,
    );
    expect(JSON.stringify(answer)).not.toContain("lead_source");
  });

  it("answers a page where nothing can be selected from DOM Health's audit of the tab", async () => {
    const domHealthOf = vi.fn(async () => undefined);
    const respond = createDiagnosisResponder({ domHealthOf });

    const answer = await respond(
      "Apty cannot select any elements on this page",
      { runContext: { conversationId: "s-5", tabId: 8 } },
    );

    expect(domHealthOf).toHaveBeenCalledWith({
      conversationId: "s-5",
      tabId: 8,
    });
    expect(answer?.params).toEqual({ kind: "page" });
    expect((answer?.result as DiagnosisResult).packId).toBe("page-readiness");
    expect(answer?.transcript).toMatch(
      /^Page selection check from DOM Health's audit of the page/,
    );
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("answers with a named no-data result when no Client is saved", async () => {
    const respond = createDiagnosisResponder({
      clientExtensionId: async () => undefined,
    });

    const answer = await respond("my workflow is not visible", {});

    expect((answer?.result as DiagnosisResult).verdict.status).toBe("no_data");
    expect(answer?.transcript).toContain(
      "No Apty Client extension ID is saved.",
    );
  });
});

describe("tabUrlOf", () => {
  it("reads the URL of the conversation's own tab, and nothing without one", async () => {
    mockTabsGet.mockResolvedValue({ url: "https://crm.example.com/leads" });

    expect(await tabUrlOf({ tabId: 9 })).toBe("https://crm.example.com/leads");
    expect(mockTabsGet).toHaveBeenCalledWith(9);
    expect(await tabUrlOf({ conversationId: "pending" })).toBeUndefined();
    mockTabsGet.mockRejectedValue(new Error("No tab with id: 9"));
    expect(await tabUrlOf({ tabId: 9 })).toBeUndefined();
  });
});

describe("transcriptOf", () => {
  it("keeps the verdict, rules, open items and what was not checked for later turns", async () => {
    const respond = createDiagnosisResponder();
    const answer = await respond(
      "the Create a lead workflow is not visible",
      {},
    );

    const transcript = answer?.transcript ?? "";

    expect(transcript).toContain(
      'Visibility check of workflow "Create a lead"',
    );
    expect(transcript).toContain("KB card 1496842241");
    expect(transcript).toContain("Result: candidates.");
    expect(transcript).toContain("- Open: The user must match the rule");
    expect(transcript).toContain("Not checked from the files:");
  });

  it("lists the scan's blockers when no item was named", async () => {
    const respond = createDiagnosisResponder();
    const answer = await respond(
      "my workflow is not visible in the widget",
      {},
    );

    expect(transcriptOf(answer?.result as DiagnosisResult)).toContain(
      "- Take a tour: hidden",
    );
  });
});

describe("run_diagnosis", () => {
  it("checks from the saved Client only, ignoring an ID smuggled into the call", async () => {
    const result = (await runDiagnosisTool.invoke(
      {} as never,
      JSON.stringify({
        kind: "workflow",
        name: "Export a report",
        extensionId: ATTACKER_ID,
      }),
    )) as DiagnosisResult;

    expect(result.verdict.causes[0]?.ruleId).toBe("CNV-07");
    const contacted = new Set(mockSendMessage.mock.calls.map((c) => c[0]));
    expect([...contacted]).toEqual([EXT_ID]);
  });

  it("runs the selector check when the model asks for an element that is not found, and needs a web page in the tab", async () => {
    mockTabsGet.mockResolvedValue({ url: "chrome://newtab/" });

    const result = (await runDiagnosisTool.invoke(
      { context: { conversationId: "s-6", tabId: 3 } } as never,
      JSON.stringify({
        kind: "tooltip",
        name: "Lead source help",
        problem: "element-not-found",
      }),
    )) as DiagnosisResult;

    expect(result.packId).toBe("element-not-found");
    expect(result.gates.find((g) => g.id === "lookup")?.reason).toBe(
      "noPageToProbe",
    );
  });

  it("runs the widget check for the tool's own tab when the model asks for kind widget", async () => {
    mockTabsGet.mockResolvedValue({ url: "https://intranet.other.example/" });

    const result = (await runDiagnosisTool.invoke(
      { context: { conversationId: "s-2", tabId: 5 } } as never,
      JSON.stringify({ kind: "widget" }),
    )) as DiagnosisResult;

    expect(mockTabsGet).toHaveBeenCalledWith(5);
    expect(result.packId).toBe("widget-not-visible");
    expect(result.verdict.causes[0]?.ruleId).toBe("WNV-02");
  });
});
