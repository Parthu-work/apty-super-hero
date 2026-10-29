import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const AGENT_ID = "bpiondflhhdplemamgggcdajclmoeple";

const mockSendMessage = vi.hoisted(() => vi.fn());
const settings = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

(globalThis as { chrome?: unknown }).chrome = {
  runtime: {
    id: AGENT_ID,
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
import {
  capture,
  resourcesFor,
  type ServedFile,
  served,
} from "./diagnosis-test-utils";
import { loadClientEvidence } from "./loader";

/** A Client that lists `files` and answers body requests for them. */
function serve(files: ServedFile[], lastError?: string) {
  const resources = resourcesFor(files);
  const bodyRequests: string[] = [];
  mockSendMessage.mockImplementation(
    (
      _id: string,
      message: { type: string; requestId?: string },
      callback: (r: unknown) => void,
    ) => {
      if (lastError) {
        chrome.runtime.lastError = { message: lastError };
        callback(undefined);
        chrome.runtime.lastError = undefined;
        return;
      }
      if (message.type === "apty-debug-agent:list-observed-resources") {
        callback({ resources });
        return;
      }
      if (message.type === "apty-debug-agent:get-resource-body") {
        bodyRequests.push(message.requestId ?? "");
        const index = resources.findIndex(
          (r) => r.requestId === message.requestId,
        );
        const body = files[index]?.body;
        callback(body === undefined ? { found: false } : { found: true, body });
        return;
      }
      callback(undefined);
    },
  );
  return { bodyRequests };
}

const NAMES = ["workflow.json", "segment.json", "app-urls.json"];

beforeEach(() => {
  mockSendMessage.mockReset();
  chrome.runtime.lastError = undefined;
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("loadClientEvidence", () => {
  it("reads every named file through redaction and keeps the content intact", async () => {
    const files = capture();
    serve(served(files));

    const evidence = await loadClientEvidence(EXT_ID, NAMES);

    expect(evidence.connection).toEqual({ ok: true });
    expect(evidence.envId).toBe("env-0e000000-0000-7000-8000-000000000002");
    expect(evidence.files["workflow.json"]?.status).toBe("ok");
    expect(evidence.files["workflow.json"]?.json).toEqual(
      files["workflow.json"],
    );
    expect(evidence.files["segment.json"]?.json).toEqual(files["segment.json"]);
    expect(evidence.observedNames).toContain("rule.json");
    expect(mockSendMessage.mock.calls.every((c) => c[0] === EXT_ID)).toBe(true);
  });

  it("names a file the Client did not report", async () => {
    serve([{ name: "segment.json", body: "[]" }]);

    const evidence = await loadClientEvidence(EXT_ID, NAMES);

    expect(evidence.files["workflow.json"]).toEqual({
      name: "workflow.json",
      status: "not_observed",
    });
    expect(evidence.files["segment.json"]?.status).toBe("empty");
  });

  it("reports an HTTP error, a failed request and a body that is not JSON", async () => {
    serve([
      { name: "workflow.json", body: '{"error":"Forbidden"}', status: 403 },
      { name: "segment.json", failed: true },
      { name: "app-urls.json", body: "<html>gateway</html>" },
    ]);

    const evidence = await loadClientEvidence(EXT_ID, NAMES);

    expect(evidence.files["workflow.json"]).toMatchObject({
      status: "http_error",
      httpStatus: 403,
    });
    expect(evidence.files["segment.json"]).toMatchObject({
      status: "failed",
      detail: "net::ERR_FAILED",
    });
    expect(evidence.files["app-urls.json"]?.status).toBe("unparsable");
  });

  it("never asks the Client for a body on the deny list, by path or by host", async () => {
    settings.value = {
      redactionMode: "strict",
      networkBodyCaptureDenyList: ["/workflow.json"],
    };
    resetRedactionModeForTests();
    const { bodyRequests } = serve(served(capture()));

    const byPath = await loadClientEvidence(EXT_ID, ["workflow.json"]);
    expect(byPath.files["workflow.json"]).toMatchObject({
      status: "body_denied",
      detail: "/workflow.json",
    });
    expect(bodyRequests).toEqual([]);

    settings.value = {
      redactionMode: "strict",
      networkBodyCaptureDenyList: ["apty.example"],
    };
    resetRedactionModeForTests();
    const byHost = await loadClientEvidence(EXT_ID, NAMES);
    expect(
      Object.values(byHost.files).map((f) => [f.status, f.detail]),
    ).toEqual([
      ["body_denied", "apty.example"],
      ["body_denied", "apty.example"],
      ["body_denied", "apty.example"],
    ]);
  });

  it("reports a body the Client did not keep, such as one over its size limit", async () => {
    const big = JSON.stringify(
      Array.from({ length: 2000 }, (_, i) => ({
        name: `w${i}`,
        pad: "x".repeat(100),
      })),
    );
    serve([{ name: "workflow.json", body: big }]);

    const evidence = await loadClientEvidence(EXT_ID, ["workflow.json"]);

    expect(evidence.files["workflow.json"]?.status).toBe("body_unavailable");
  });

  it("falls back to an older call of the file when the newest has no body", async () => {
    const files = capture();
    serve([
      { name: "workflow.json", body: JSON.stringify(files["workflow.json"]) },
      { name: "workflow.json" },
    ]);

    const evidence = await loadClientEvidence(EXT_ID, ["workflow.json"]);

    expect(evidence.files["workflow.json"]?.status).toBe("ok");
  });

  it("says why the Client could not be reached", async () => {
    serve([], "Could not establish connection. Receiving end does not exist.");

    const evidence = await loadClientEvidence(EXT_ID, NAMES);

    expect(evidence.connection.ok).toBe(false);
    expect(evidence.files).toEqual({});
  });

  it("says when no Client is configured", async () => {
    const evidence = await loadClientEvidence(undefined, NAMES);

    expect(evidence.connection).toEqual({
      ok: false,
      failure: "not_configured",
      message: "No Apty Client extension ID is saved.",
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
