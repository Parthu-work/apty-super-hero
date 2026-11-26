import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

(globalThis as { chrome?: unknown }).chrome = {
  runtime: { id: "agent", onMessage: { addListener() {} } },
  storage: {
    local: { get: vi.fn(async (key: string) => ({ [key]: settings.value })) },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
  tabs: { onRemoved: { addListener() {} } },
};

import { queryEvidenceJson } from "../apty/evidence-json-query";
import {
  forgetCase,
  pinnedContext,
  setReplaySourceFactoryForTests,
} from "../apty/replay/case-replay";
import { createReplaySource } from "../apty/replay/content-source";
import { resetRedactionModeForTests } from "../runtime/redaction-mode";
import {
  fetchAptyFileTool,
  listAptyFilesTool,
  resolveAptyContextTool,
} from "./apty-content";

const CDN = "https://content.apty.example";
const T = `${CDN}/tenant-t1`;
const E = `${T}/app-a1/env-e1`;
const SEGMENTS = [
  { id: "g1", isActive: true, name: "Sales team" },
  { id: "g2", isActive: false, name: "Old" },
];
const files: Record<string, unknown> = {
  [`${T}/content-config.json`]: {
    latest: 1,
    "app-a1": { "env-e1": { "segment.json": 2 } },
  },
  [`${E}/segment.json`]: SEGMENTS,
};
const requested: string[] = [];

type Invocable = { invoke: (ctx: unknown, input: string) => Promise<unknown> };
const call = async (tool: unknown, args: object, conversationId = "case-1") =>
  (await (tool as Invocable).invoke(
    { context: { conversationId, tabId: 3 } },
    JSON.stringify(args),
  )) as Record<string, unknown>;

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
  requested.length = 0;
  setReplaySourceFactoryForTests((deps) =>
    createReplaySource({
      ...deps,
      page: {
        probe: async () => ({ ok: false, reason: "no-apty" }),
        userValue: async () => undefined,
      },
      policyOrigins: async () => [CDN],
      fetchImpl: (async (input: RequestInfo | URL) => {
        const path = String(input).replace(/\?.*$/, "");
        requested.push(path);
        return path in files
          ? new Response(JSON.stringify(files[path]), { status: 200 })
          : new Response("{}", { status: 404 });
      }) as unknown as typeof fetch,
    }),
  );
  forgetCase("case-1");
});

const IDS = { tenantId: "t1", applicationId: "a1", environmentId: "e1" };

describe("resolve_apty_context", () => {
  it("pins the IDs the SE gave for the case, and shows the host only as an origin", async () => {
    const result = await call(resolveAptyContextTool, IDS);
    expect(result).toMatchObject({
      ok: true,
      pinned: true,
      tenantId: "t1",
      applicationId: "a1",
      environmentId: "e1",
      contentHost: CDN,
      idsFrom: { tenant: "given", environment: "given" },
    });
    expect(pinnedContext("case-1")?.environmentId).toBe("e1");
    expect(pinnedContext("case-2")).toBeUndefined();
  });

  it("cannot point the Agent at a host the policy does not name", async () => {
    const result = await call(resolveAptyContextTool, {
      ...IDS,
      contentOrigin: "https://attacker.example",
    });
    expect(result).toMatchObject({ ok: false, failure: "host_not_allowed" });
    expect(pinnedContext("case-1")).toBeUndefined();
  });

  it("refuses an ID that is not a plain path segment before anything runs", async () => {
    await expect(
      call(resolveAptyContextTool, { ...IDS, environmentId: "e1/../../x" }),
    ).resolves.not.toMatchObject({ ok: true });
    expect(requested).toEqual([]);
  });
});

describe("fetch_apty_file", () => {
  it("returns a structural summary and an evidence id that get_evidence_json pages", async () => {
    await call(resolveAptyContextTool, IDS);
    const result = await call(fetchAptyFileTool, { file: "segment.json" });
    expect(result).toMatchObject({
      ok: true,
      source: "published file, fetched by the Agent",
      httpStatus: 200,
      fromCache: false,
    });
    const response = result.response as {
      evidenceId: string;
      json: { kind: string };
    };
    expect(response.json).toMatchObject({ kind: "array", itemCount: 2 });
    expect(
      queryEvidenceJson("case-1", response.evidenceId, "[1].name", 20, 0),
    ).toMatchObject({ found: true, value: "Old" });

    const again = await call(fetchAptyFileTool, { file: "segment.json" });
    expect(again.fromCache).toBe(true);
    expect(requested.filter((p) => p.endsWith("segment.json"))).toHaveLength(1);
  });

  it("names the failure: not published, unknown file, or no context", async () => {
    expect(
      await call(fetchAptyFileTool, { file: "tooltip.json" }),
    ).toMatchObject({
      ok: false,
      failure: "no_apty",
    });
    await call(resolveAptyContextTool, IDS);
    expect(
      await call(fetchAptyFileTool, { file: "tooltip.json" }),
    ).toMatchObject({
      ok: false,
      failure: "not_published",
      httpStatus: 404,
    });
    const before = requested.length;
    expect(
      await call(fetchAptyFileTool, { file: "../../admin/users.json" }),
    ).toMatchObject({ ok: false, failure: "unknown_file" });
    expect(requested).toHaveLength(before);
  });
});

describe("list_apty_files", () => {
  it("lists the player's files and which content-config.json names", async () => {
    await call(resolveAptyContextTool, IDS);
    const result = await call(listAptyFilesTool, {});
    const rows = result.files as Array<{
      name: string;
      inContentConfig?: boolean;
    }>;
    expect(rows.find((f) => f.name === "segment.json")?.inContentConfig).toBe(
      true,
    );
    expect(rows.find((f) => f.name === "tooltip.json")?.inContentConfig).toBe(
      false,
    );
    expect(
      rows.find((f) => f.name === "workflow-{workflowId}.json"),
    ).not.toHaveProperty("inContentConfig");
  });
});

describe("the tools' inputs", () => {
  it("take no URL: only IDs, a catalogue file name and a policy-checked origin", () => {
    for (const tool of [
      resolveAptyContextTool,
      listAptyFilesTool,
      fetchAptyFileTool,
    ]) {
      const params = (tool as unknown as { parameters: { properties: object } })
        .parameters.properties;
      expect(Object.keys(params)).not.toContain("url");
    }
  });
});
