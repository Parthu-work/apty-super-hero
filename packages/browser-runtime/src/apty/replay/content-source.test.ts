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

import type { AptyContentContext } from "@apty/agent-core";
import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import type { AptyPage, AptyPageProbe } from "../apty-cdn-source";
import {
  createReplaySource,
  fileTimestamp,
  MAX_REPLAY_FILE_BYTES,
  type ReplayDeps,
} from "./content-source";

const CDN = "https://content.apty.ai";
const OTHER = "https://other-content.example";
const TENANT = "0f000000-0000-7000-8000-000000000000";
const APP = "0a000000-0000-7000-8000-000000000001";
const ENV = "0e000000-0000-7000-8000-000000000002";
const T = `${CDN}/tenant-${TENANT}`;
const E = `${T}/app-${APP}/env-${ENV}`;
const PAGE = "https://uat.crm.example.com/leads/42";

const APP_URLS = [
  {
    id: APP,
    environments: [
      { id: "prod", order: 1, urls: ["https://crm.example.com/*"] },
      { id: ENV, order: 2, urls: ["https://uat.crm.example.com/*"] },
    ],
  },
];
const TOOLTIPS = [{ id: "i1", sourceId: "s1", name: "Lead source help" }];

type Served =
  | unknown
  | Error
  | { status: number; body?: string; headers?: Record<string, string> };

function host(files: Record<string, Served>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const served = files[url.replace(/\?.*$/, "")];
      if (served === undefined) return new Response("{}", { status: 404 });
      if (served instanceof Error) throw served;
      if (
        typeof served === "object" &&
        served !== null &&
        "status" in served &&
        typeof (served as { status: unknown }).status === "number" &&
        !Array.isArray(served) &&
        "body" in served
      ) {
        const s = served as {
          status: number;
          body?: string;
          headers?: Record<string, string>;
        };
        return new Response(s.status === 304 ? null : (s.body ?? ""), {
          status: s.status,
          headers: s.headers,
        });
      }
      return new Response(
        typeof served === "string" ? served : JSON.stringify(served),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  ) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const onPage = (
  probe?: Partial<AptyPageProbe & { ok: true }>["config"],
): AptyPage => ({
  probe: async () => ({
    ok: true,
    config: {
      mode: "extension",
      contentURL: CDN,
      tenantId: TENANT,
      pageUrl: PAGE,
      ...probe,
    },
  }),
  userValue: async () => undefined,
});

const noApty: AptyPage = {
  probe: async () => ({ ok: false, reason: "no-apty" }),
  userValue: async () => undefined,
};

function source(files: Record<string, Served>, deps: Partial<ReplayDeps> = {}) {
  const { fetchImpl, calls } = host(files);
  return {
    calls,
    replay: createReplaySource({
      page: onPage(),
      fetchImpl,
      now: () => 1_000,
      ...deps,
    }),
  };
}

async function resolved(
  replay: ReturnType<typeof createReplaySource>,
  input = {},
) {
  const result = await replay.resolveContext(input);
  if (!result.ok) throw new Error(result.detail);
  return result.context;
}

const GIVEN = { tenantId: TENANT, applicationId: APP, environmentId: ENV };

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("fileTimestamp (the player's getFileTimestamp)", () => {
  const config = {
    latest: 10,
    "app-urls.json": 11,
    [`app-${APP}`]: {
      latest: 20,
      "app-data.json": 21,
      [`env-${ENV}`]: { "tooltip.json": 31 },
    },
  };
  const now = () => 99;
  it.each([
    [["app-urls.json"], 11],
    [[`app-${APP}`, "app-data.json"], 21],
    [[`app-${APP}`, `env-${ENV}`, "tooltip.json"], 31],
    [[`app-${APP}`, `env-${ENV}`, "workflow.json"], 20],
    [[`app-${APP}`, "env-other", "tooltip.json"], 20],
    [["app-other", "app-data.json"], 10],
  ])("finds %j at %i", (path, expected) => {
    expect(fileTimestamp(config, path, now)).toBe(expected);
  });
  it("falls back to now with no config or no latest", () => {
    expect(fileTimestamp(undefined, ["x"], now)).toBe(99);
    expect(fileTimestamp({}, ["x"], now)).toBe(99);
  });
});

describe("resolveContext", () => {
  it("takes the tenant and host from the page and the environment from its URL", async () => {
    const { replay, calls } = source({ [`${T}/app-urls.json`]: APP_URLS });
    expect(await replay.resolveContext()).toEqual({
      ok: true,
      context: {
        version: "5.x",
        contentURL: CDN,
        tenantId: TENANT,
        applicationId: APP,
        environmentId: ENV,
        mode: "extension",
        idsFrom: { tenant: "page", environment: "url-match" },
      },
    });
    expect(calls.map((c) => c.url.replace(/\?.*/, ""))).toEqual([
      `${T}/content-config.json`,
      `${T}/app-urls.json`,
    ]);
  });

  it("makes no request when every ID is given", async () => {
    const { replay, calls } = source({});
    const context = await resolved(replay, GIVEN);
    expect(context.idsFrom).toEqual({ tenant: "given", environment: "given" });
    expect(calls).toHaveLength(0);
  });

  it("finds the application of a given environment in app-urls.json", async () => {
    const { replay } = source({ [`${T}/app-urls.json`]: APP_URLS });
    const context = await resolved(replay, {
      tenantId: TENANT,
      environmentId: ENV,
    });
    expect(context).toMatchObject({ applicationId: APP, environmentId: ENV });
    expect(
      await replay.resolveContext({
        tenantId: TENANT,
        environmentId: "0e000000-0000-7000-8000-0000000000ff",
      }),
    ).toMatchObject({
      ok: false,
      failure: "no_environment_match",
    });
  });

  it("names a page no environment matches", async () => {
    const { replay } = source(
      { [`${T}/app-urls.json`]: APP_URLS },
      { page: onPage({ pageUrl: "https://elsewhere.example.com/" }) },
    );
    expect(await replay.resolveContext()).toMatchObject({
      ok: false,
      failure: "no_environment_match",
    });
  });

  it("says no_apty on a page without Apty and nothing given, ids_missing for an unsafe ID", async () => {
    const { replay } = source({}, { page: noApty });
    expect(await replay.resolveContext()).toMatchObject({
      ok: false,
      failure: "no_apty",
    });
    const { replay: onApty } = source({});
    expect(
      await onApty.resolveContext({ ...GIVEN, environmentId: "../x" }),
    ).toMatchObject({
      ok: false,
      failure: "ids_missing",
    });
  });

  it("uses a host only from the page or the organization policy", async () => {
    const policy = { policyOrigins: async () => [OTHER] };
    const noPage = { page: noApty, ...policy };
    expect(await resolved(source({}, noPage).replay, GIVEN)).toMatchObject({
      contentURL: OTHER,
    });
    expect(
      await source({}, noPage).replay.resolveContext({
        ...GIVEN,
        contentURL: "https://evil.example",
      }),
    ).toMatchObject({ ok: false, failure: "host_not_allowed" });
    expect(
      await source({}, { page: noApty }).replay.resolveContext(GIVEN),
    ).toMatchObject({
      ok: false,
      failure: "host_not_allowed",
    });
    expect(
      await source(
        {},
        { page: noApty, policyOrigins: async () => [OTHER, CDN] },
      ).replay.resolveContext(GIVEN),
    ).toMatchObject({ ok: false, failure: "ids_missing" });
    expect(
      await resolved(
        source({}, { page: noApty, policyOrigins: async () => [OTHER, CDN] })
          .replay,
        {
          ...GIVEN,
          contentURL: CDN,
        },
      ),
    ).toMatchObject({ contentURL: CDN });
    expect(
      await source({}).replay.resolveContext({
        ...GIVEN,
        contentURL: "http://content.apty.ai",
      }),
    ).toMatchObject({ ok: false, failure: "host_not_allowed" });
  });

  it("refuses a page-named content URL on a private network address unless the policy lists it", async () => {
    for (const contentURL of [
      "https://10.0.0.5",
      "https://192.168.1.10/apty",
      "https://172.20.0.1",
      "https://169.254.169.254",
      "https://[fd00::1]",
      "https://[::ffff:10.0.0.5]",
      "https://[64:ff9b::a00:5]",
      "https://[fec0::1]",
      "https://[::1]",
      "https://0xa000005",
      "https://167772165",
    ]) {
      const { replay, calls } = source({}, { page: onPage({ contentURL }) });
      expect(await replay.resolveContext(GIVEN)).toMatchObject({
        ok: false,
        failure: "host_not_allowed",
      });
      expect(calls).toHaveLength(0);
    }
    const listed = source(
      {},
      {
        page: onPage({ contentURL: "https://10.0.0.5" }),
        policyOrigins: async () => ["https://10.0.0.5"],
      },
    );
    expect(await resolved(listed.replay, GIVEN)).toMatchObject({
      contentURL: "https://10.0.0.5",
    });
    // Migrated by AUDIT-CORRECTIONS A1: a public IP literal the page names
    // was accepted; no IP literal is an Apty content host, so it is refused.
    expect(
      await source(
        {},
        { page: onPage({ contentURL: "https://172.32.0.1" }) },
      ).replay.resolveContext(GIVEN),
    ).toMatchObject({ ok: false, failure: "host_not_allowed" });
  });

  it("asks for both IDs on 4.x", async () => {
    // A 4.x content host off *.apty.io needs the policy (A1).
    const { replay } = source({}, { policyOrigins: async () => [CDN] });
    expect(
      await replay.resolveContext({ version: "4.x", tenantId: "k" }),
    ).toMatchObject({
      ok: false,
      failure: "ids_missing",
    });
    expect(
      await resolved(replay, {
        version: "4.x",
        tenantId: "k",
        applicationId: "7",
        environmentId: "1",
      }),
    ).toMatchObject({ version: "4.x", environmentId: "1" });
  });

  it("asks for a 4.x file the way player3.0 does, with its empty token", async () => {
    const { replay, calls } = source(
      { [`${CDN}/tenant-k/app-7/env-1/flow.json`]: [] },
      { policyOrigins: async () => [CDN] },
    );
    const context = await resolved(replay, {
      version: "4.x",
      tenantId: "k",
      applicationId: "7",
      environmentId: "1",
    });
    expect(await replay.fetchFile(context, "flow.json")).toMatchObject({
      ok: true,
    });
    expect(calls[0]?.url).toBe(
      `${CDN}/tenant-k/app-7/env-1/flow.json?timestamp=1000&token=`,
    );
  });
});

describe("fetchFile", () => {
  async function ready(
    files: Record<string, Served>,
    deps: Partial<ReplayDeps> = {},
  ) {
    const s = source(files, deps);
    return { ...s, context: await resolved(s.replay, GIVEN) };
  }

  it("asks for the file with the player's timestamp, no credentials and no redirects", async () => {
    const { replay, context, calls } = await ready({
      [`${T}/content-config.json`]: {
        latest: 5,
        [`app-${APP}`]: { [`env-${ENV}`]: { "tooltip.json": 1234 } },
      },
      [`${E}/tooltip.json`]: TOOLTIPS,
    });
    const result = await replay.fetchFile(context, "tooltip.json");
    expect(result).toMatchObject({
      ok: true,
      httpStatus: 200,
      json: TOOLTIPS,
      fromCache: false,
    });
    expect(calls.map((c) => c.url)).toEqual([
      `${T}/content-config.json?timestamp=1000`,
      `${E}/tooltip.json?timestamp=1234`,
    ]);
    for (const { init } of calls) {
      expect(init).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "error",
      });
    }
  });

  it("reads a content-config wrapped in payload, as the player does", async () => {
    const { replay, context, calls } = await ready({
      [`${T}/content-config.json`]: {
        payload: { [`app-${APP}`]: { [`env-${ENV}`]: { "segment.json": 77 } } },
      },
      [`${E}/segment.json`]: [{ id: "g", isActive: true }],
    });
    await replay.fetchFile(context, "segment.json");
    expect(calls[1]?.url).toBe(`${E}/segment.json?timestamp=77`);
  });

  it.each([
    ["a 404", { status: 404, body: "{}" }, "not_published", 404],
    [
      "CloudFront's 200 not-found page",
      { message: "No data found", status: 404 },
      "not_published",
      200,
    ],
    ["a 500", { status: 500, body: "oops" }, "http_500", 500],
    ["a 403", { status: 403, body: "" }, "http_403", 403],
    ["a body that is not JSON", "<html>", "unparsable", 200],
    ["a body of the wrong shape", [{ name: "no id" }], "schema_mismatch", 200],
  ])("names %s", async (_label, served, failure, httpStatus) => {
    const { replay, context } = await ready({ [`${E}/tooltip.json`]: served });
    expect(await replay.fetchFile(context, "tooltip.json")).toMatchObject({
      ok: false,
      failure,
      httpStatus,
      path: `tenant-${TENANT}/app-${APP}/env-${ENV}/tooltip.json`,
    });
  });

  it("names a network failure and a body too large to keep", async () => {
    const { replay, context } = await ready({
      [`${E}/tooltip.json`]: new TypeError("Failed to fetch"),
      [`${E}/rule.json`]: "x".repeat(MAX_REPLAY_FILE_BYTES + 1),
    });
    expect(await replay.fetchFile(context, "tooltip.json")).toMatchObject({
      ok: false,
      failure: "network",
      detail: "Failed to fetch",
    });
    expect(await replay.fetchFile(context, "rule.json")).toMatchObject({
      ok: false,
      failure: "too_large",
    });
  });

  it("names a host that does not answer in time", async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    ) as unknown as typeof fetch;
    const replay = createReplaySource({
      page: onPage(),
      fetchImpl,
      timeoutMs: 5,
    });
    const context = await resolved(replay, GIVEN);
    expect(await replay.fetchFile(context, "app-urls.json")).toMatchObject({
      ok: false,
      failure: "timeout",
    });
  });

  it("requests nothing on the body deny list", async () => {
    const { replay, context, calls } = await ready(
      { [`${E}/tooltip.json`]: TOOLTIPS },
      { denyList: async () => ["content.apty.ai"] },
    );
    expect(await replay.fetchFile(context, "tooltip.json")).toMatchObject({
      ok: false,
      failure: "body_denied",
    });
    expect(calls).toHaveLength(0);
  });

  it("redacts the body before anyone reads it", async () => {
    const { replay, context } = await ready({
      [`${E}/tooltip.json`]: [
        { id: "i", sourceId: "s", name: "Ask jane.doe@example.com" },
      ],
    });
    const result = await replay.fetchFile(context, "tooltip.json");
    expect(result.ok && result.text).not.toContain("jane.doe@example.com");
  });

  it("names a file outside the catalogue, missing IDs and an unresolved host, with no request", async () => {
    const { replay, context, calls } = await ready({});
    expect(await replay.fetchFile(context, "../../admin.json")).toMatchObject({
      failure: "unknown_file",
    });
    expect(
      await replay.fetchFile(context, "workflow-{workflowId}.json"),
    ).toMatchObject({
      failure: "ids_missing",
    });
    const forged: AptyContentContext = {
      ...context,
      contentURL: "https://evil.example",
    };
    expect(await replay.fetchFile(forged, "app-urls.json")).toMatchObject({
      failure: "host_not_allowed",
    });
    expect(calls).toHaveLength(0);
  });

  it("asks once for a file several checks need at the same moment, content-config.json included", async () => {
    const { replay, context, calls } = await ready({
      [`${T}/content-config.json`]: { latest: 5 },
      [`${E}/segment.json`]: [{ id: "g", isActive: true }],
      [`${E}/rule.json`]: [],
    });
    const results = await Promise.all([
      replay.fetchFile(context, "segment.json"),
      replay.fetchFile(context, "segment.json"),
      replay.fetchFile(context, "rule.json"),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const paths = calls.map((c) => c.url.replace(/\?.*$/, ""));
    expect(
      paths.filter((p) => p.endsWith("/content-config.json")),
    ).toHaveLength(1);
    expect(paths.filter((p) => p.endsWith("/segment.json"))).toHaveLength(1);
    expect(paths).toHaveLength(3);
  });

  it("keeps the case's copy, and asks again conditionally when told to", async () => {
    const files: Record<string, Served> = {
      [`${T}/app-urls.json`]: {
        status: 200,
        body: JSON.stringify(APP_URLS),
        headers: { etag: '"v1"' },
      },
    };
    const { replay, context, calls } = await ready(files);
    await replay.fetchFile(context, "app-urls.json");
    expect(await replay.fetchFile(context, "app-urls.json")).toMatchObject({
      ok: true,
      fromCache: true,
    });
    expect(calls.map((c) => c.url.replace(/\?.*/, ""))).toEqual([
      `${T}/content-config.json`,
      `${T}/app-urls.json`,
    ]);

    files[`${T}/app-urls.json`] = { status: 304, body: "" };
    expect(
      await replay.fetchFile(context, "app-urls.json", {}, { fresh: true }),
    ).toMatchObject({
      ok: true,
      json: APP_URLS,
      fromCache: true,
    });
    expect(calls).toHaveLength(3);
    expect(new Headers(calls[2]?.init?.headers).get("if-none-match")).toBe(
      '"v1"',
    );

    replay.clear();
    expect(await replay.fetchFile(context, "app-urls.json")).toMatchObject({
      failure: "host_not_allowed",
    });
  });
});

describe("one host gate on every path (AUDIT-CORRECTIONS A1)", () => {
  it("refuses a page-named host off Apty's content domain, with no request, naming the policy key", async () => {
    for (const contentURL of [
      "https://intranet.example",
      "https://cdn.apty.io",
      "https://content.apty.ai:8443",
      "http://127.0.0.1:4100",
      "http://localhost",
    ]) {
      const { replay, calls } = source({}, { page: onPage({ contentURL }) });
      expect(await replay.resolveContext(GIVEN)).toMatchObject({
        ok: false,
        failure: "host_not_allowed",
        detail: expect.stringContaining("aptyContentOrigins"),
      });
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses a given host that equals a private page host", async () => {
    const { replay, calls } = source(
      {},
      { page: onPage({ contentURL: "https://10.0.0.5" }) },
    );
    expect(
      await replay.resolveContext({ ...GIVEN, contentURL: "https://10.0.0.5" }),
    ).toMatchObject({ ok: false, failure: "host_not_allowed" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a given host that equals any page host off Apty's domain", async () => {
    const { replay } = source(
      {},
      { page: onPage({ contentURL: "https://intranet.example" }) },
    );
    expect(
      await replay.resolveContext({
        ...GIVEN,
        contentURL: "https://intranet.example",
      }),
    ).toMatchObject({ ok: false, failure: "host_not_allowed" });
  });

  it("takes a given host on Apty's domain, or one the policy lists, loopback included", async () => {
    expect(
      await resolved(source({}, { page: noApty }).replay, {
        ...GIVEN,
        contentURL: "https://eu.content.apty.ai/",
      }),
    ).toMatchObject({ contentURL: "https://eu.content.apty.ai" });
    expect(
      await resolved(
        source(
          {},
          {
            page: onPage({ contentURL: "http://127.0.0.1:4100" }),
            policyOrigins: async () => ["http://127.0.0.1:4100"],
          },
        ).replay,
        GIVEN,
      ),
    ).toMatchObject({ contentURL: "http://127.0.0.1:4100" });
  });

  it("checks each version's ID shapes before any request", async () => {
    const { replay, calls } = source({});
    for (const input of [
      { ...GIVEN, tenantId: "t1" },
      { ...GIVEN, applicationId: "7" },
      { ...GIVEN, environmentId: "%2e%2e" },
      {
        version: "4.x" as const,
        tenantId: "k",
        applicationId: APP,
        environmentId: "1",
      },
    ]) {
      expect(await replay.resolveContext(input)).toMatchObject({
        ok: false,
        failure: "ids_missing",
      });
    }
    expect(calls).toHaveLength(0);
  });
});

describe("fetch time and byte limits, and abort (AUDIT-CORRECTIONS A2)", () => {
  const streamed = (
    chunks: string[],
    { end = true, headers = {} as Record<string, string> } = {},
  ) => {
    const encoder = new TextEncoder();
    const state = { pulled: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[state.pulled++];
          if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
          else if (end) controller.close();
          else return new Promise<void>(() => undefined);
          return undefined;
        },
        cancel() {
          state.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    return { response: new Response(body, { status: 200, headers }), state };
  };

  function sourceServing(
    serve: (url: string) => Response,
    deps: Partial<ReplayDeps> = {},
  ) {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      serve(String(input).replace(/\?.*$/, "")),
    ) as unknown as typeof fetch;
    return createReplaySource({
      page: onPage(),
      fetchImpl,
      now: () => 1_000,
      ...deps,
    });
  }

  it("keeps the time limit running while a body drips in, and caches nothing", async () => {
    const drip = streamed(['[{"id":'], { end: false });
    const replay = sourceServing(
      (url) =>
        url.endsWith("content-config.json")
          ? new Response("{}", { status: 200 })
          : drip.response,
      { timeoutMs: 20 },
    );
    const context = await resolved(replay, GIVEN);
    expect(await replay.fetchFile(context, "tooltip.json")).toMatchObject({
      ok: false,
      failure: "timeout",
    });
    expect(drip.state.cancelled).toBe(true);
  });

  it("stops reading a body past the per-file byte cap, without Content-Length", async () => {
    const big = streamed(["x".repeat(60), "x".repeat(60), "x".repeat(60)]);
    const replay = sourceServing(
      (url) =>
        url.endsWith("content-config.json")
          ? new Response("{}", { status: 200 })
          : big.response,
      { maxFileBytes: 100 },
    );
    const context = await resolved(replay, GIVEN);
    expect(await replay.fetchFile(context, "tooltip.json")).toMatchObject({
      ok: false,
      failure: "too_large",
      detail: expect.stringContaining("100 bytes"),
    });
    expect(big.state.pulled).toBeLessThan(3);
    expect(big.state.cancelled).toBe(true);
  });

  it("refuses a body whose Content-Length is over the cap before reading it", async () => {
    const declared = streamed(["[]"], { headers: { "content-length": "101" } });
    const replay = sourceServing(
      (url) =>
        url.endsWith("content-config.json")
          ? new Response("{}", { status: 200 })
          : declared.response,
      { maxFileBytes: 100 },
    );
    const context = await resolved(replay, GIVEN);
    expect(await replay.fetchFile(context, "tooltip.json")).toMatchObject({
      ok: false,
      failure: "too_large",
    });
    expect(declared.state.pulled).toBe(0);
  });

  it("counts bytes across the case and stops past the per-case cap", async () => {
    const replay = sourceServing(
      (url) =>
        new Response(
          url.endsWith("content-config.json") ? "{}" : `[${" ".repeat(70)}]`,
          { status: 200 },
        ),
      { maxCaseBytes: 120 },
    );
    const context = await resolved(replay, GIVEN);
    expect(await replay.fetchFile(context, "tooltip.json")).toMatchObject({
      ok: true,
    });
    expect(await replay.fetchFile(context, "rule.json")).toMatchObject({
      ok: false,
      failure: "too_large",
      detail: expect.stringContaining("limit for one case"),
    });
  });

  it("aborts what is under way when the case closes", async () => {
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("content-config.json")
        ? Promise.resolve(new Response("{}", { status: 200 }))
        : new Promise<Response>((_resolve, reject) => {
            seen = init?.signal ?? undefined;
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
    ) as unknown as typeof fetch;
    const replay = createReplaySource({ page: onPage(), fetchImpl });
    const context = await resolved(replay, GIVEN);
    const pending = replay.fetchFile(context, "tooltip.json");
    await vi.waitFor(() => expect(seen).toBeDefined());
    replay.clear();
    expect(await pending).toMatchObject({ ok: false, failure: "aborted" });
  });

  it("aborts on the caller's signal too", async () => {
    const closed = new AbortController();
    const drip = streamed(["["], { end: false });
    const replay = sourceServing(
      (url) =>
        url.endsWith("content-config.json")
          ? new Response("{}", { status: 200 })
          : drip.response,
      { signal: closed.signal },
    );
    const context = await resolved(replay, GIVEN);
    const pending = replay.fetchFile(context, "tooltip.json");
    await vi.waitFor(() => expect(drip.state.pulled).toBeGreaterThan(0));
    closed.abort();
    expect(await pending).toMatchObject({ ok: false, failure: "aborted" });
  });
});
