import { describe, expect, it } from "vitest";
import {
  buildRequest,
  CONTRACT_VERBS,
  CONTRACT_VERSION,
  getLogsResponseSchema,
  getNetworkResponseSchema,
  getResourceBodyResponseSchema,
  LEGACY_VERBS,
  MESSAGE_PREFIX,
  networkEntrySchema,
  parseVerb,
  pingDataSchema,
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  VERB_SCHEMAS,
} from "./contract";

describe("buildRequest / parseVerb round-trip", () => {
  it("builds a request whose type parseVerb recovers the original verb from", () => {
    for (const verb of CONTRACT_VERBS) {
      const request = buildRequest(verb, "req-1", { some: "param" });
      expect(request.v).toBe(CONTRACT_VERSION);
      expect(request.type).toBe(`${MESSAGE_PREFIX}${verb}`);
      expect(parseVerb(request.type)).toBe(verb);
    }
  });

  it("still recognizes every legacy verb (a producer that hasn't adopted v1 must still be parseable)", () => {
    for (const verb of LEGACY_VERBS) {
      expect(parseVerb(verb)).toBe(verb);
    }
  });

  it("returns null for anything that isn't a recognized verb or doesn't carry the message prefix", () => {
    expect(parseVerb("apty-debug-agent:not-a-real-verb")).toBeNull();
    expect(parseVerb("some-other-extensions-message")).toBeNull();
    expect(parseVerb(42)).toBeNull();
    expect(parseVerb(undefined)).toBeNull();
  });

  it("requestEnvelopeSchema accepts a built request and rejects a type without the message prefix", () => {
    const request = buildRequest("ping", "req-1");
    expect(requestEnvelopeSchema.parse(request)).toEqual(request);
    expect(() =>
      requestEnvelopeSchema.parse({ ...request, type: "not-apty-shaped" }),
    ).toThrow();
  });
});

describe("responseEnvelopeSchema", () => {
  it("accepts a success envelope and an error envelope, discriminated on `ok`", () => {
    const ok = { v: 1, requestId: "r1", ok: true, data: { anything: 1 } };
    const err = {
      v: 1,
      requestId: "r1",
      ok: false,
      error: { code: "peer_error", message: "boom" },
    };
    expect(responseEnvelopeSchema.parse(ok).ok).toBe(true);
    expect(responseEnvelopeSchema.parse(err).ok).toBe(false);
  });

  it("rejects an ok:false envelope with no error field", () => {
    expect(() =>
      responseEnvelopeSchema.parse({ v: 1, requestId: "r1", ok: false }),
    ).toThrow();
  });
});

describe("pingDataSchema — identity fields are required, not optional", () => {
  const validPing = {
    product: "apty-client" as const,
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    version: "1.0.0",
    contractVersion: 1,
    capabilities: ["logs" as const],
    now: Date.now(),
    swStartedAt: Date.now(),
    captureEnabled: false,
    buffers: {
      logs: { count: 0, oldestSeq: null, newestSeq: null, dropped: 0 },
    },
  };

  it("accepts a fully-formed ping response", () => {
    expect(pingDataSchema.parse(validPing)).toBeTruthy();
  });

  it("rejects an empty object — an unrelated extension replying {} must not be reported as a real peer", () => {
    expect(() => pingDataSchema.parse({})).toThrow();
  });

  it("rejects a response missing extensionId, product, or contractVersion individually", () => {
    const { extensionId, ...withoutId } = validPing;
    void extensionId;
    expect(() => pingDataSchema.parse(withoutId)).toThrow();

    const { product, ...withoutProduct } = validPing;
    void product;
    expect(() => pingDataSchema.parse(withoutProduct)).toThrow();

    const { contractVersion, ...withoutVersion } = validPing;
    void contractVersion;
    expect(() => pingDataSchema.parse(withoutVersion)).toThrow();
  });
});

describe("get-resource-body is a first-class v1 verb, not just legacy", () => {
  it("is in CONTRACT_VERBS and has a VERB_SCHEMAS entry", () => {
    expect(CONTRACT_VERBS).toContain("get-resource-body");
    expect(VERB_SCHEMAS["get-resource-body"]).toBeDefined();
  });

  it("its response schema round-trips a found body and a not-found reason", () => {
    expect(
      getResourceBodyResponseSchema.parse({
        found: true,
        body: "{}",
        base64Encoded: false,
      }),
    ).toBeTruthy();
    expect(
      getResourceBodyResponseSchema.parse({
        found: false,
        reason: "capture_disabled",
      }),
    ).toBeTruthy();
  });
});

describe("networkEntrySchema (v4 shape)", () => {
  it("accepts the documented field set", () => {
    const entry = {
      seq: 1,
      requestId: "req-abc",
      ts: Date.now(),
      method: "GET",
      url: "https://example.com/segments.json",
      status: 200,
      mimeType: "application/json",
      failed: false,
      durationMs: 42,
      context: "service-worker" as const,
    };
    expect(networkEntrySchema.parse(entry)).toEqual(entry);
  });

  it("a get-network response round-trips a list of entries with pagination fields", () => {
    const response = {
      entries: [],
      nextSeq: 0,
      oldestSeq: null,
      dropped: 0,
      truncated: false,
    };
    expect(getNetworkResponseSchema.parse(response)).toEqual(response);
  });
});

describe("getLogsResponseSchema", () => {
  it("round-trips an empty page with pagination metadata", () => {
    const response = {
      entries: [],
      nextSeq: 0,
      oldestSeq: null,
      dropped: 0,
      truncated: false,
    };
    expect(getLogsResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects a log entry whose message exceeds the 4000-char cap", () => {
    expect(() =>
      getLogsResponseSchema.parse({
        entries: [
          {
            seq: 1,
            ts: Date.now(),
            level: "info",
            message: "x".repeat(4001),
            context: "service-worker",
          },
        ],
        nextSeq: 1,
        oldestSeq: 1,
        dropped: 0,
        truncated: false,
      }),
    ).toThrow();
  });
});
