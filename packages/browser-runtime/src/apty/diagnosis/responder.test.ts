import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const ATTACKER_ID = "p".repeat(32);

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
};

import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import { runDiagnosisTool } from "../../tools/diagnosis";
import { capture, resourcesFor, served } from "./diagnosis-test-utils";
import {
  createDiagnosisResponder,
  RUN_DIAGNOSIS,
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

  it("answers with a named no-data result when no Client is saved", async () => {
    const respond = createDiagnosisResponder(async () => undefined);

    const answer = await respond("my workflow is not visible", {});

    expect((answer?.result as DiagnosisResult).verdict.status).toBe("no_data");
    expect(answer?.transcript).toContain(
      "No Apty Client extension ID is saved.",
    );
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
});
