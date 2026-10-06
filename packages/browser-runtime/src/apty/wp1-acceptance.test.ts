/**
 * WP1 acceptance fixture — "the Apty Integration pulls logs and response
 * data perfectly."
 *
 * A fake Apty Client extension that records a ~200-item segments resource
 * (singular `segment.json` on the wire, so the plural "segments.json" the
 * user actually asks for must be tolerantly matched), a 403 with an XML
 * error body, a batch of noisy repeated service-worker logs, and a batch of
 * analytics logs carrying real PII. Exercises the real tool-level code path
 * (`inspectResource` / `listServiceWorkerLogs` / `matchResources` /
 * `queryEvidenceJson`) through the same mocked cross-extension transport
 * every other test in this directory uses — not a rewritten contract, the
 * actual code the Agent calls today.
 *
 * This is a permanent regression fixture, not a one-off check: every
 * concrete bug this round fixed (tolerant matching, bodies for every HTTP
 * status, the bare-`name` over-redaction, bounding what reaches the model
 * for a large JSON body) is asserted here together, in one realistic
 * scenario, so a future change can't silently reintroduce any of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop"; // 32 chars, a-p

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockManagementGet = vi.hoisted(() => vi.fn());

(global as any).chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: undefined as { message: string } | undefined,
  },
  management: {
    get: mockManagementGet,
  },
};

import { queryEvidenceJson } from "./evidence-json-query";
import { clearEvidence, getEvidence } from "./evidence-store";
import {
  connectExtensionClient,
  disconnectExtensionClient,
  inspectResource,
  listServiceWorkerLogs,
} from "./extension-network-inspector";

const OK_STATUS = { running: true, lastActivity: 1 };
const CONV = "wp1-acceptance";

// --- Fixture: ~206-item segments resource, the real resource is named
// "segment.json" (singular) but the user will ask for "segments.json". ---
const SEGMENT_COUNT = 206;
const segmentItems = Array.from({ length: SEGMENT_COUNT }, (_, i) => ({
  id: 4385 + i,
  name: i === 0 ? "sales-team" : `segment-${i}`,
  isActive: i % 2 === 0,
  conditions: [[{ key: "region", value: `r${i % 5}`, relation: "eq" }]],
  createdDate: "2024-01-01T00:00:00.000Z",
}));
const segmentBody = JSON.stringify(segmentItems);

// --- Fixture: a 403 with an XML error body on a differently-named resource. ---
const tagErrorBody =
  "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>";

// --- Fixture: ~60 noisy, identical service-worker heartbeat logs, plus 12
// analytics lines carrying real PII (user id, username, page title). ---
const noisyLogs = Array.from({ length: 60 }, (_, i) => ({
  level: "debug" as const,
  message: "heartbeat: service worker alive",
  timestamp: 1000 + i,
}));
const analyticsLogs = Array.from({ length: 12 }, (_, i) => ({
  level: "info" as const,
  message: JSON.stringify({
    event_name: "page_view",
    event_sequence: i, // varies per entry so these 12 lines are never collapsed into one
    user_id: "12345",
    username: "jane.doe",
    page_title: "Patient Record - John Smith",
  }),
  timestamp: 2000 + i,
}));
const allLogs = [...noisyLogs, ...analyticsLogs];

function mockResponsesByType(
  handlers: Record<string, unknown | ((message: any) => unknown)>,
) {
  mockSendMessage.mockImplementation(
    (
      _extensionId: string,
      message: { type: string },
      callback: (response: unknown) => void,
    ) => {
      const handler = handlers[message.type];
      callback(
        handler === undefined
          ? undefined
          : typeof handler === "function"
            ? handler(message)
            : handler,
      );
    },
  );
}

const resources = [
  {
    requestId: "req-segment",
    url: "https://cdn.apty.io/api/segment.json",
    method: "GET",
    status: 200,
    mimeType: "application/json",
    timestamp: 1,
  },
  {
    requestId: "req-tag",
    url: "https://cdn.apty.io/api/tag.json",
    method: "GET",
    status: 403,
    mimeType: "application/xml",
    timestamp: 2,
  },
];

function bodyHandlerFor(requestId: string) {
  if (requestId === "req-segment") {
    return { found: true, body: segmentBody, base64Encoded: false };
  }
  if (requestId === "req-tag") {
    return { found: true, body: tagErrorBody, base64Encoded: false };
  }
  return { found: false };
}

beforeEach(async () => {
  mockSendMessage.mockReset();
  mockManagementGet.mockReset();
  chrome.runtime.lastError = undefined;
  mockManagementGet.mockResolvedValue({ id: EXT_ID, enabled: true });

  mockResponsesByType({
    "apty-debug-agent:get-service-worker-status": OK_STATUS,
    "apty-debug-agent:list-observed-resources": { resources },
    "apty-debug-agent:get-resource-body": (message: { requestId: string }) =>
      bodyHandlerFor(message.requestId),
    "apty-debug-agent:get-service-worker-logs": { logs: allLogs },
  });

  await connectExtensionClient(CONV, EXT_ID);
});

afterEach(async () => {
  await disconnectExtensionClient(CONV);
  clearEvidence(CONV);
});

describe("WP1 acceptance: segments.json resolves to the real segment.json resource", () => {
  it("tolerantly matches the plural query against the singular resource name", async () => {
    const result = await inspectResource(CONV, "segments.json");
    expect(result.found).toBe(true);
    expect(result.request?.resourceName).toBe("segment.json");
    expect(result.request?.matchKind).toBe("tolerant");
  });

  it("the full body (all 206 items, names intact) is in evidence for the user's viewer", async () => {
    const result = await inspectResource(CONV, "segments.json");
    const evidenceId = result.response?.evidenceId;
    expect(evidenceId).toBeTruthy();

    const full = getEvidence(CONV).find((e) => e.evidenceId === evidenceId);
    const storedBody = (full?.data as { body?: string } | undefined)?.body;
    expect(storedBody).toBeTruthy();
    const parsed = JSON.parse(storedBody as string);
    expect(parsed).toHaveLength(SEGMENT_COUNT);
    expect(parsed[0].name).toBe("sales-team"); // not <REDACTED>
    expect(parsed[1].name).toBe("segment-1");
  });

  it("the model-bound payload is bounded, not the full 206 items, but states the correct count", async () => {
    const result = await inspectResource(CONV, "segments.json");
    expect(result.response?.json?.kind).toBe("array");
    expect(result.response?.json?.itemCount).toBe(SEGMENT_COUNT);
    expect(
      (result.response?.json?.sample as unknown[]).length,
    ).toBeLessThanOrEqual(5);
    // The raw inline preview is the (small) JSON-encoded sample, never a
    // blind character slice of the full ~100kB body.
    expect(result.response?.bodyPreview.length).toBeLessThan(2000);
    expect(result.response?.truncated).toBe(true);
  });

  it("get_evidence_json can page through all 206 items using the evidenceId", async () => {
    const result = await inspectResource(CONV, "segments.json");
    const evidenceId = result.response?.evidenceId as string;

    const first = queryEvidenceJson(CONV, evidenceId, "", 50, 0);
    expect(first.found).toBe(true);
    expect(first.kind).toBe("array");
    expect(first.total).toBe(SEGMENT_COUNT);
    expect((first.value as unknown[]).length).toBe(50);

    const last = queryEvidenceJson(CONV, evidenceId, "", 50, 200);
    expect((last.value as unknown[]).length).toBe(6); // 206 - 200

    const one = queryEvidenceJson(CONV, evidenceId, "0.name");
    expect(one.kind).toBe("scalar");
    expect(one.value).toBe("sales-team");
  });

  it("asking for a nonexistent resource suggests the closest observed names instead of failing flatly", async () => {
    const result = await inspectResource(CONV, "segmetn.json"); // typo
    expect(result.status).toBe("not_observed");
    expect(result.suggestions?.length).toBeGreaterThan(0);
    expect(result.suggestions?.[0]?.resourceName).toBe("segment.json");
  });
});

describe("WP1 acceptance: bodies are returned for every HTTP status, including 403", () => {
  it("returns the 403's actual XML error body, not just a bare failure", async () => {
    const result = await inspectResource(CONV, "tag.json");
    expect(result.status).toBe("http_error");
    expect(result.found).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.response?.bodyPreview).toContain("AccessDenied");
  });
});

describe("WP1 acceptance: service-worker logs are capped, collapsed, and redacted", () => {
  it("collapses 60 identical heartbeat lines into one with a repeatCount, and reports per-level counts", async () => {
    const result = await listServiceWorkerLogs(CONV, { limit: 500 });
    expect(result.connected).toBe(true);
    if (!result.connected) return;

    const heartbeat = result.logs.find((l) => l.text.includes("heartbeat"));
    expect(heartbeat?.repeatCount).toBe(60);
    expect(result.header.countsByLevel.debug).toBe(60);
    expect(result.header.countsByLevel.info).toBe(12);
    // 60 collapsed into 1, plus 12 distinct analytics lines.
    expect(result.header.totalBeforeLimit).toBe(13);
  });

  it("respects the default limit (50) and reports that it truncated", async () => {
    // 72 raw entries collapse to 13 unique lines, well under the default
    // limit of 50 — assert explicitly with a tight limit instead.
    const result = await listServiceWorkerLogs(CONV, { limit: 5 });
    expect(result.connected).toBe(true);
    if (!result.connected) return;
    expect(result.logs.length).toBe(5);
    expect(result.header.truncatedByLimit).toBe(true);
  });

  it("never lets raw PII (user id, username, page title) reach the model-bound log text", async () => {
    const result = await listServiceWorkerLogs(CONV, { limit: 500 });
    expect(result.connected).toBe(true);
    if (!result.connected) return;

    const analyticsLine = result.logs.find((l) => l.text.includes("page_view"));
    expect(analyticsLine).toBeTruthy();
    expect(analyticsLine?.text).not.toContain("jane.doe");
    expect(analyticsLine?.text).not.toContain("John Smith");
    expect(analyticsLine?.text).not.toContain('"user_id":"12345"');
  });
});
