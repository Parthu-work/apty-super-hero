/**
 * KB-RAG K26 D2, D7: the pack fetcher, with a fake fetch, a fake clock and
 * packs signed by keys made in the test. Every pack here is synthetic.
 */
import type { OrgPolicy, OrgPolicyState } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKbPackStore } from "../storage/kb-store.js";
import { createKbIndexSource } from "./kb-index.js";
import { localKbMatches } from "./kb-matches.js";
import {
  createKbDeliveryNote,
  createKbPackSync,
  type KbSyncRecord,
  type KbSyncSendRow,
  kbSyncBackoffMs,
  readKbSyncRecords,
} from "./kb-pack-sync.js";
import {
  memoryRecords,
  signedPackText,
  testSigningKey,
} from "./kb-test-utils.js";
import { createKbPackAssessor } from "./kb-trust.js";

const ci = testSigningKey("FIXTURE KB CI");
const stranger = testSigningKey("FIXTURE stranger");
const SOURCE_5X = "https://packs.example.com/kb/5x.json?token=never-stored";
const SOURCE_4X = "https://packs.example.com/kb/4x.json";
const T0 = new Date("2026-11-13T00:00:00.000Z");

const OLD = signedPackText(ci, { builtAt: "2026-11-01T00:00:00.000Z" });
const NEW = signedPackText(ci, { builtAt: "2026-11-10T00:00:00.000Z" });

type Reply = Response | (() => Response | Promise<Response>) | Error;

function pack(text: string, headers: Record<string, string> = {}) {
  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function setup({
  policy = { kbPackSources: { "5.x": SOURCE_5X } },
}: {
  policy?: OrgPolicy;
} = {}) {
  let clock = T0;
  let current: OrgPolicy = { trustedPackKeys: [ci.key], ...policy };
  const policyState = async (): Promise<OrgPolicyState> => ({
    kind: "active",
    policy: current,
  });
  const records = memoryRecords();
  const store = createKbPackStore({
    records,
    now: () => clock,
    assess: createKbPackAssessor({ policy: policyState, now: () => clock }),
  });
  const replies: Reply[] = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = replies.shift();
      if (!next) throw new Error("FIXTURE: no reply queued");
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next() : next;
    },
  );
  const sent: KbSyncSendRow[] = [];
  const onUpdated = vi.fn(async () => undefined);
  const sync = createKbPackSync({
    store,
    records,
    policy: policyState,
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => clock,
    record: async (row) => {
      sent.push(row);
    },
    onUpdated,
  });
  return {
    sync,
    store,
    records,
    fetch,
    calls,
    replies,
    sent,
    onUpdated,
    source: createKbIndexSource(store),
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    setPolicy(next: OrgPolicy) {
      current = { trustedPackKeys: [ci.key], ...next };
    },
    syncRecord: async () =>
      (await readKbSyncRecords(records))["5.x"] as KbSyncRecord,
  };
}

describe("createKbPackSync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("makes no request when the policy names no source", async () => {
    const env = setup({ policy: {} });
    expect(await env.sync.syncAll({ reason: "startup" })).toEqual([]);
    expect(env.fetch).not.toHaveBeenCalled();
    expect(env.sent).toEqual([]);
  });

  it("fetches only the policy's URLs, with the session, no cache and conditional headers", async () => {
    const env = setup({
      policy: { kbPackSources: { "5.x": SOURCE_5X, "4.x": SOURCE_4X } },
    });
    env.replies.push(new Response("", { status: 404 }));
    env.replies.push(
      pack(OLD, {
        etag: '"v1"',
        "last-modified": "Sat, 01 Nov 2026 00:00:00 GMT",
      }),
    );
    await env.sync.syncAll({ reason: "manual" });
    expect(env.calls.map((call) => call.url)).toEqual([SOURCE_4X, SOURCE_5X]);
    for (const { init } of env.calls) {
      expect(init).toMatchObject({
        method: "GET",
        credentials: "include",
        cache: "no-cache",
      });
      expect(init.body).toBeUndefined();
    }
    env.replies.push(new Response("", { status: 404 }));
    env.replies.push(new Response(null, { status: 304 }));
    await env.sync.syncAll({ reason: "manual" });
    expect(env.calls[3]?.init.headers).toEqual({
      "If-None-Match": '"v1"',
      "If-Modified-Since": "Sat, 01 Nov 2026 00:00:00 GMT",
    });
  });

  it("stores a first pack and a newer one, used with no reload", async () => {
    const env = setup();
    env.replies.push(pack(OLD));
    expect(await env.sync.syncAll({ reason: "startup" })).toEqual([
      { version: "5.x", outcome: "updated", httpStatus: 200 },
    ]);
    expect(await env.source.current("5.x")).not.toBeNull();
    expect((await env.store.info())[0]?.builtAt).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    env.replies.push(pack(NEW));
    await env.sync.syncAll({ reason: "manual" });
    expect((await env.store.info())[0]?.builtAt).toBe(
      "2026-11-10T00:00:00.000Z",
    );
    expect(env.onUpdated).toHaveBeenCalledTimes(2);
  });

  it("records what it saw: never the body, the path or the query", async () => {
    const env = setup();
    env.replies.push(pack(OLD, { etag: '"v1"' }));
    await env.sync.syncAll({ reason: "startup" });
    const record = await env.syncRecord();
    expect(record).toEqual({
      version: "5.x",
      host: "packs.example.com",
      lastCheckAt: T0.toISOString(),
      lastSuccessAt: T0.toISOString(),
      outcome: "updated",
      httpStatus: 200,
      sha256: JSON.parse(OLD).sha256,
      etag: '"v1"',
      failures: 0,
    });
    expect(env.sent).toEqual([
      {
        at: T0.toISOString(),
        version: "5.x",
        origin: "https://packs.example.com",
        status: 200,
        outcome: "updated",
      },
    ]);
    const kept = JSON.stringify([record, env.sent]);
    expect(kept).not.toContain("token");
    expect(kept).not.toContain("/kb/");
    expect(kept).not.toContain("FIXTURE");
  });

  it.each([
    ["not_modified", () => new Response(null, { status: 304 })],
    ["http_403", () => new Response("sign in", { status: 403 })],
    ["http_500", () => new Response("", { status: 500 })],
    ["network", () => new TypeError("Failed to fetch")],
    [
      "wrong_type",
      () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ],
    [
      "too_large",
      () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": String(26 * 1024 * 1024),
          },
        }),
    ],
    ["not_json", () => pack("not json")],
    ["checksum_mismatch", () => pack(OLD.replace("FIXTURE", "FIXTURF"))],
    [
      "untrusted_key",
      () =>
        pack(signedPackText(stranger, { builtAt: "2026-11-11T00:00:00.000Z" })),
    ],
    [
      "unsigned",
      () => pack(signedPackText(null, { builtAt: "2026-11-11T00:00:00.000Z" })),
    ],
    [
      "expired",
      () =>
        pack(
          signedPackText(ci, {
            builtAt: "2026-11-11T00:00:00.000Z",
            expiresAt: "2026-11-12T00:00:00.000Z",
          }),
        ),
    ],
    [
      "version_mismatch",
      () =>
        pack(
          signedPackText(ci, {
            aptyVersion: "4.x",
            builtAt: "2026-11-11T00:00:00.000Z",
          }),
        ),
    ],
    ["unchanged", () => pack(NEW)],
    ["older", () => pack(OLD)],
  ] as const)("gives %s and keeps the stored pack answering", async (code, reply) => {
    const env = setup();
    env.replies.push(pack(NEW));
    await env.sync.syncAll({ reason: "startup" });
    const value = reply();
    env.replies.push(value instanceof Error ? value : () => value);
    const [result] = await env.sync.syncAll({ reason: "manual" });
    expect(result?.outcome).toBe(code);
    const stored = await env.store.info();
    expect(stored.map((info) => info.sha256)).toEqual([JSON.parse(NEW).sha256]);
    expect(await env.source.current("5.x")).not.toBeNull();
    expect((await env.syncRecord()).outcome).toBe(code);
    expect(env.sent.at(-1)?.outcome).toBe(code);
  });

  it("refuses a body past the limit as it streams, with no Content-Length", async () => {
    const env = setup();
    const sync = createKbPackSync({
      store: env.store,
      records: env.records,
      policy: async () => ({
        kind: "active",
        policy: { kbPackSources: { "5.x": SOURCE_5X } },
      }),
      fetch: (async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(600));
              controller.enqueue(new Uint8Array(600));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/plain" } },
        )) as typeof globalThis.fetch,
      maxBytes: 1000,
    });
    expect(await sync.syncAll({ reason: "manual" })).toEqual([
      { version: "5.x", outcome: "too_large", httpStatus: 200 },
    ]);
  });

  it("gives timeout when the host does not answer in time", async () => {
    const env = setup();
    const sync = createKbPackSync({
      store: env.store,
      records: env.records,
      policy: async () => ({
        kind: "active",
        policy: { kbPackSources: { "5.x": SOURCE_5X } },
      }),
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        })) as unknown as typeof globalThis.fetch,
      timeoutMs: 5,
    });
    expect(await sync.syncAll({ reason: "manual" })).toEqual([
      { version: "5.x", outcome: "timeout" },
    ]);
  });

  it("backs off a failing version: 5 minutes, then doubling, capped at the interval", async () => {
    expect(kbSyncBackoffMs(0, 6)).toBe(0);
    expect(kbSyncBackoffMs(1, 6)).toBe(5 * 60_000);
    expect(kbSyncBackoffMs(2, 6)).toBe(10 * 60_000);
    expect(kbSyncBackoffMs(8, 6)).toBe(6 * 3_600_000);
    expect(kbSyncBackoffMs(30, 1)).toBe(3_600_000);

    const env = setup();
    env.replies.push(new Response("", { status: 503 }));
    await env.sync.syncAll({ reason: "startup" });
    expect((await env.syncRecord()).failures).toBe(1);
    env.advance(4 * 60_000);
    expect(await env.sync.syncAll({ reason: "alarm" })).toEqual([
      { version: "5.x", outcome: "deferred" },
    ]);
    expect(env.fetch).toHaveBeenCalledTimes(1);
    env.advance(60_000);
    env.replies.push(new Response("", { status: 503 }));
    await env.sync.syncAll({ reason: "alarm" });
    expect((await env.syncRecord()).failures).toBe(2);
    env.advance(9 * 60_000);
    expect((await env.sync.syncAll({ reason: "alarm" }))[0]?.outcome).toBe(
      "deferred",
    );
    // Check now does not wait.
    env.replies.push(pack(NEW));
    expect((await env.sync.syncAll({ reason: "manual" }))[0]?.outcome).toBe(
      "updated",
    );
    expect((await env.syncRecord()).failures).toBe(0);
  });

  it("runs one sync at a time: a second call joins the first", async () => {
    const env = setup();
    let release: (response: Response) => void = () => undefined;
    env.replies.push(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const first = env.sync.syncAll({ reason: "startup" });
    const second = env.sync.syncAll({ reason: "manual" });
    expect(second).toBe(first);
    await vi.waitFor(() => expect(env.fetch).toHaveBeenCalledTimes(1));
    release(pack(NEW));
    expect(await second).toEqual([
      { version: "5.x", outcome: "updated", httpStatus: 200 },
    ]);
    expect(env.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the stored pack loaded when the policy later revokes the CI key", async () => {
    const env = setup();
    env.replies.push(pack(NEW));
    await env.sync.syncAll({ reason: "startup" });
    env.setPolicy({
      kbPackSources: { "5.x": SOURCE_5X },
      revokedPackKeyIds: [ci.key.keyId],
    });
    env.replies.push(
      pack(signedPackText(ci, { builtAt: "2026-11-12T00:00:00.000Z" })),
    );
    const [result] = await env.sync.syncAll({ reason: "manual" });
    expect(result?.outcome).toBe("revoked_key");
    expect((await env.store.info()).map((info) => info.sha256)).toEqual([
      JSON.parse(NEW).sha256,
    ]);
  });

  it("sends no conditional headers once the stored pack is gone", async () => {
    const env = setup();
    env.replies.push(pack(NEW, { etag: '"v2"' }));
    await env.sync.syncAll({ reason: "startup" });
    await env.store.remove("5.x");
    env.replies.push(pack(NEW, { etag: '"v2"' }));
    const [result] = await env.sync.syncAll({ reason: "manual" });
    expect(env.calls[1]?.init.headers).toEqual({});
    expect(result?.outcome).toBe("updated");
  });
});

describe("createKbDeliveryNote (K26 D4)", () => {
  const sourced = async (): Promise<OrgPolicyState> => ({
    kind: "active",
    policy: { kbPackSources: { "5.x": SOURCE_5X } },
  });

  it("names a sourced version whose last check failed, and nothing otherwise", async () => {
    const records = memoryRecords();
    const note = createKbDeliveryNote({
      records: () => records,
      policy: sourced,
    });
    expect(await note("5.x")).toBeUndefined();
    await records.putAll([
      ["sync:5.x", { version: "5.x", outcome: "http_403", failures: 1 }],
    ]);
    expect(await note("5.x")).toEqual({ version: "5.x", outcome: "http_403" });
    expect(await note("unknown")).toEqual({
      version: "5.x",
      outcome: "http_403",
    });
    expect(await note("4.x")).toBeUndefined();
    await records.putAll([
      ["sync:5.x", { version: "5.x", outcome: "not_modified", failures: 0 }],
    ]);
    expect(await note("5.x")).toBeUndefined();
  });

  it("reads no record without a source", async () => {
    const get = vi.fn();
    const note = createKbDeliveryNote({
      records: () => ({ ...memoryRecords(), get }),
      policy: async () => ({ kind: "none" }),
    });
    expect(await note("5.x")).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it("puts the failure on the KB outcome when no pack is usable", async () => {
    const env = setup();
    const outcome = await localKbMatches(
      "FIXTURE banner never glows",
      env.source,
      {
        version: "5.x",
        delivery: async () => ({ version: "5.x", outcome: "http_403" }),
      },
    );
    expect(outcome).toEqual({
      kind: "no_pack",
      version: "5.x",
      delivery: { version: "5.x", outcome: "http_403" },
    });
  });
});
