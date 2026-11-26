import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
import { createAptyFiles } from "../diagnosis/apty-files";
import { loadEvidenceFrom } from "../diagnosis/loader";
import { playerVersionOf } from "../diagnosis/pack-kit";
import { runPack } from "../diagnosis/responder";
import type { ClientEvidence } from "../diagnosis/types";
import {
  caseReplay,
  forgetCase,
  pinContext,
  pinnedContext,
  replayResourceSource,
  setReplaySourceFactoryForTests,
} from "./case-replay";
import { createReplaySource } from "./content-source";

const FIXTURES = join(__dirname, "../diagnosis/fixtures/content-5x");
const CDN = "https://content.apty.example";
const TENANT = "0f000000-0000-7000-8000-000000000000";
const APP = "0a000000-0000-7000-8000-000000000001";
const ENV = "0e000000-0000-7000-8000-000000000002";
const ENV_PATH = `${CDN}/tenant-${TENANT}/app-${APP}/env-${ENV}`;

const fixtureFiles = () =>
  Object.fromEntries(
    readdirSync(FIXTURES).map((name) => [
      name,
      readFileSync(join(FIXTURES, name), "utf8"),
    ]),
  );

/** A content host serving the synthetic 5.x files; `override` replaces or removes (undefined) one. */
function contentHost(override: Record<string, string | undefined> = {}) {
  const files = { ...fixtureFiles(), ...override };
  const routes: Record<string, string | undefined> = {
    [`${CDN}/tenant-${TENANT}/app-urls.json`]: files["app-urls.json"],
    [`${CDN}/tenant-${TENANT}/app-${APP}/app-data.json`]:
      files["app-data.json"],
    ...Object.fromEntries(
      Object.entries(files).map(([name, text]) => [
        `${ENV_PATH}/${name}`,
        text,
      ]),
    ),
  };
  const requested: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace(/\?.*$/, "");
    requested.push(path);
    const body = routes[path];
    // Like CloudFront: a missing file is a 200 not-found page.
    return new Response(
      body ?? JSON.stringify({ message: "No data found", status: 404 }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, requested };
}

const silent: ClientEvidence = {
  connection: { ok: false, failure: "no_receiver", message: "no Client" },
  observedNames: [],
  files: {},
};

async function pinnedSource(
  override?: Record<string, string | undefined>,
  denyList: readonly string[] = [],
) {
  const host = contentHost(override);
  const source = createReplaySource({
    fetchImpl: host.fetchImpl,
    policyOrigins: async () => [CDN],
    denyList: async () => denyList,
  });
  const resolved = await source.resolveContext({
    tenantId: TENANT,
    applicationId: APP,
    environmentId: ENV,
  });
  if (!resolved.ok) throw new Error(resolved.detail);
  return { source, context: resolved.context, host };
}

const noPage = {
  pageUrl: async () => undefined,
  pageConsole: async () => undefined,
  probeElement: async () => ({
    ok: false as const,
    code: "no_page",
    message: "",
  }),
  domHealth: async () => undefined,
};

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("replayResourceSource", () => {
  it("hands the loader each file with the status the check packs read", async () => {
    const { source, context } = await pinnedSource({
      "tooltip.json": undefined,
    });
    const evidence = await loadEvidenceFrom(
      replayResourceSource(source, context, [
        "segment.json",
        "tooltip.json",
        "flow.json",
      ]),
      ["segment.json", "tooltip.json", "flow.json"],
    );
    expect(evidence.files["segment.json"]).toMatchObject({
      status: "ok",
      httpStatus: 200,
    });
    expect(evidence.files["tooltip.json"]).toMatchObject({
      status: "http_error",
      httpStatus: 404,
    });
    expect(evidence.files["flow.json"]?.status).toBe("not_observed");
    expect(evidence.envId).toBe(`env-${ENV}`);
  });

  it("reports a request that failed as failed, with the named reason", async () => {
    const source = createReplaySource({
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      policyOrigins: async () => [CDN],
    });
    const resolved = await source.resolveContext({
      tenantId: TENANT,
      applicationId: APP,
      environmentId: ENV,
    });
    if (!resolved.ok) throw new Error(resolved.detail);
    const evidence = await loadEvidenceFrom(
      replayResourceSource(source, resolved.context, ["segment.json"]),
      ["segment.json"],
    );
    expect(evidence.files["segment.json"]).toMatchObject({ status: "failed" });
    expect(evidence.files["segment.json"]?.detail).toContain("network");
  });

  it("keeps a denied file's body out, through the loader's own deny-list check", async () => {
    settings.value = {
      redactionMode: "strict",
      networkBodyCaptureDenyList: ["/segment.json"],
    };
    resetRedactionModeForTests();
    const { source, context, host } = await pinnedSource({}, ["/segment.json"]);
    const evidence = await loadEvidenceFrom(
      replayResourceSource(source, context, ["segment.json"]),
      ["segment.json"],
    );
    expect(evidence.files["segment.json"]?.status).toBe("body_denied");
    expect(host.requested.some((p) => p.endsWith("segment.json"))).toBe(false);
  });
});

describe("check packs on replayed files, with no Client record", () => {
  async function run(
    route: Parameters<typeof runPack>[0],
    override?: Record<string, string | undefined>,
  ) {
    const { source, context } = await pinnedSource(override);
    const apty = createAptyFiles({
      clientFiles: async () => silent,
      replay: () => ({ source, context }),
    });
    return runPack(route, undefined, {
      ...noPage,
      files: (names) =>
        apty.files({ tabId: 1, conversationId: "c" }, undefined, names),
    });
  }

  it("finds a workflow hidden from the widget, each file gate naming the Agent's fetch", async () => {
    const result = await run({
      packId: "content-not-visible",
      kind: "workflow",
      query: "Take a tour",
    });
    expect(result.verdict.status).toBe("cause_found");
    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "CNV-03",
      evidence: ["workflow.json: hideFromWidget = true"],
    });
    expect(result.filesFromCdn).toBe(true);
    expect(result.filesFromReplay).toBe(true);
    const published = result.gates.find((g) => g.id === "published");
    expect(published?.source).toBe("agent");
  });

  it("finds a workflow a segment lists but this environment does not publish", async () => {
    const archived = "0c000000-0000-7000-8000-000000000009";
    const result = await run({
      packId: "content-not-visible",
      kind: "workflow",
      query: archived,
    });
    expect(result.verdict.causes[0]?.ruleId).toBe("CNV-02");
  });

  it("says the tooltip file is not published when the host serves its not-found page", async () => {
    const result = await run(
      {
        packId: "content-not-visible",
        kind: "tooltip",
        query: "Lead source help",
      },
      { "tooltip.json": undefined },
    );
    expect(result.verdict.status).toBe("no_data");
    expect(result.files.find((f) => f.name === "tooltip.json")).toMatchObject({
      status: "http_error",
      httpStatus: 404,
    });
  });

  it("finds the tooltip when it is published, and leaves the user's segment to the browser", async () => {
    const result = await run({
      packId: "content-not-visible",
      kind: "tooltip",
      query: "Lead source help",
    });
    expect(result.subject.matched).toHaveLength(1);
    expect(result.gates.find((g) => g.id === "published")).toMatchObject({
      status: "pass",
      source: "agent",
    });
    expect(result.notChecked).toContain("membership");
  });
});

describe("createAptyFiles with a pinned context", () => {
  it("keeps the Client's record first, and replays only when it has none", async () => {
    const { source, context } = await pinnedSource();
    const answered: ClientEvidence = {
      connection: { ok: true },
      observedNames: ["segment.json"],
      files: {
        "segment.json": { name: "segment.json", status: "ok", json: [] },
      },
    };
    const replay = vi.fn(() => ({ source, context }));
    const talking = createAptyFiles({
      clientFiles: async () => answered,
      replay,
    });
    expect(await talking.files({ tabId: 1 }, "ext", ["segment.json"])).toBe(
      answered,
    );
    expect(replay).not.toHaveBeenCalled();

    const cdn = vi.fn();
    const quiet = createAptyFiles({
      clientFiles: async () => silent,
      replay,
      cdn,
    });
    const evidence = await quiet.files({ tabId: 1 }, "ext", ["segment.json"]);
    expect(evidence).toMatchObject({ fromCdn: true, fromReplay: true });
    expect(cdn).not.toHaveBeenCalled();
  });
});

describe("a pinned 4.x context", () => {
  it("is judged by the 4.x packs, not taken for 5.x because the Agent fetched it", async () => {
    const source = createReplaySource({
      fetchImpl: (async () =>
        new Response("[]", { status: 200 })) as unknown as typeof fetch,
      policyOrigins: async () => [CDN],
    });
    const resolved = await source.resolveContext({
      version: "4.x",
      tenantId: "k",
      applicationId: "7",
      environmentId: "1",
    });
    if (!resolved.ok) throw new Error(resolved.detail);
    const apty = createAptyFiles({
      clientFiles: async () => silent,
      replay: () => ({ source, context: resolved.context }),
    });
    const evidence = await apty.files({ tabId: 1 }, undefined, ["flow.json"]);
    expect(evidence.replayVersion).toBe("4.x");
    expect(playerVersionOf(evidence)).toBe("4.x");
  });
});

describe("the case registry", () => {
  const context: AptyContentContext = {
    version: "5.x",
    contentURL: CDN,
    tenantId: TENANT,
    applicationId: APP,
    environmentId: ENV,
    idsFrom: { tenant: "given", environment: "given" },
  };

  it("pins a context per case and forgets it with the case's cache", () => {
    const clear = vi.fn();
    setReplaySourceFactoryForTests((deps) => ({
      ...createReplaySource(deps),
      clear,
    }));
    pinContext("case-1", context);
    expect(pinnedContext("case-1")).toBe(context);
    expect(pinnedContext("case-2")).toBeUndefined();
    expect(caseReplay("case-1").source).toBe(caseReplay("case-1").source);
    forgetCase("case-1");
    expect(pinnedContext("case-1")).toBeUndefined();
    expect(clear).toHaveBeenCalledOnce();
  });

  it("keeps at most twenty open cases, forgetting the oldest", () => {
    setReplaySourceFactoryForTests((deps) => createReplaySource(deps));
    pinContext("first", context);
    for (let i = 0; i < 20; i++) caseReplay(`case-${i}`);
    expect(pinnedContext("first")).toBeUndefined();
    pinContext("case-19", context);
    expect(pinnedContext("case-19")).toBe(context);
  });
});
