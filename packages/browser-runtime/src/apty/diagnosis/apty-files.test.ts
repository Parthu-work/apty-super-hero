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

import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import type { CdnResourceSource } from "../apty-cdn-source";
import { createAptyFiles } from "./apty-files";
import type { ClientEvidence } from "./types";

const WORKFLOWS =
  "https://client.apty.example/tenant-t/app-a/env-e/workflow.json";

const answered: ClientEvidence = {
  connection: { ok: true },
  observedNames: ["workflow.json", "flow.json"],
  files: {
    "workflow.json": { name: "workflow.json", status: "ok", json: [] },
    "flow.json": { name: "flow.json", status: "ok", json: [] },
  },
};
/** A connected Client whose content script does not run on the tab's site. */
const answeredEmpty: ClientEvidence = {
  connection: { ok: true },
  observedNames: [],
  files: {
    "workflow.json": { name: "workflow.json", status: "not_observed" },
  },
};
const silent: ClientEvidence = {
  connection: { ok: false, failure: "no_receiver", message: "no Client" },
  observedNames: [],
  files: {},
};

function cdnWith(json: unknown): CdnResourceSource {
  return {
    listResources: async () => ({
      ok: true,
      resources: [
        {
          requestId: "w",
          url: WORKFLOWS,
          method: "GET",
          status: 200,
          timestamp: 1,
          hasBody: true,
        },
      ],
    }),
    getResourceBody: async () => ({
      found: true,
      body: JSON.stringify(json),
      base64Encoded: false,
    }),
    probe: async () => ({ ok: false, reason: "no-apty" }),
    storedChat: async () => "not-requested",
  };
}

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("createAptyFiles", () => {
  it("keeps the Client's files when it answers, and never reads the CDN", async () => {
    const cdn = vi.fn(() => cdnWith([]));
    const apty = createAptyFiles({ clientFiles: async () => answered, cdn });

    expect(await apty.files({ tabId: 1 }, "ext", ["workflow.json"])).toBe(
      answered,
    );
    expect(cdn).not.toHaveBeenCalled();
  });

  it("reads the named files from the CDN when the Client does not answer, once per file set", async () => {
    const cdn = vi.fn(() => cdnWith([{ name: "Export" }]));
    const apty = createAptyFiles({ clientFiles: async () => silent, cdn });

    const first = await apty.files({ tabId: 1 }, "ext", ["workflow.json"]);
    await apty.files({ tabId: 1 }, "ext", ["workflow.json"]);
    await apty.files({ tabId: 1 }, "ext", ["workflow-0c05.json"]);

    expect(first.fromCdn).toBe(true);
    expect(first.files["workflow.json"]?.status).toBe("ok");
    expect(cdn).toHaveBeenCalledTimes(2);
    expect(cdn).toHaveBeenLastCalledWith(1, ["workflow-0c05.json"], {
      storedChats: false,
    });
  });

  it("asks the Client the page shows only when it answers the ping", async () => {
    const clientFiles = vi.fn(async () => silent);
    const quiet = createAptyFiles({
      clientFiles,
      detectClient: async () => "p".repeat(32),
      clientAnswers: async () => false,
    });
    const talking = createAptyFiles({
      clientFiles,
      detectClient: async () => "q".repeat(32),
      clientAnswers: async () => true,
    });

    await quiet.files({ tabId: 1 }, undefined, ["rule.json"]);
    await talking.files({ tabId: 1 }, undefined, ["rule.json"]);

    expect(clientFiles).toHaveBeenNthCalledWith(1, undefined, ["rule.json"]);
    expect(clientFiles).toHaveBeenNthCalledWith(2, "q".repeat(32), [
      "rule.json",
    ]);
  });

  it("keeps the Client's reason and adds that the CDN could not be read either", async () => {
    const apty = createAptyFiles({
      clientFiles: async () => silent,
      cdn: () => ({
        ...cdnWith([]),
        listResources: async () => ({
          ok: false,
          resources: [],
          failure: "no_receiver" as const,
        }),
      }),
    });

    const read = await apty.files({ tabId: 1 }, undefined, ["rule.json"]);

    expect(read.connection).toMatchObject({
      ok: false,
      failure: "no_receiver",
    });
    expect(read.connection.ok || read.connection.message).toMatch(
      /^no Client Apty's content CDN could not be read either/,
    );
  });

  it("with the content CDN setting off, never reads the CDN and keeps the Client's own reason", async () => {
    const cdn = vi.fn(() => cdnWith([{ name: "Export" }]));
    const cdnFallback = vi.fn(async () => false);
    const clientAnswers = vi.fn(async () => false);
    const apty = createAptyFiles({
      clientFiles: async () => silent,
      detectClient: async () => "p".repeat(32),
      clientAnswers,
      cdn,
      cdnFallback,
    });

    const read = await apty.files({ tabId: 1 }, undefined, ["rule.json"]);

    expect(read).toBe(silent);
    expect(cdn).not.toHaveBeenCalled();
    expect(clientAnswers).toHaveBeenCalledWith("p".repeat(32));
    expect(await apty.cdnFor(1, ["rule.json"])).toBeUndefined();
  });

  it("reads the setting each time, so turning it back on takes effect without a reload", async () => {
    let on = false;
    const cdn = vi.fn(() => cdnWith([{ name: "Export" }]));
    const apty = createAptyFiles({
      clientFiles: async () => silent,
      cdn,
      cdnFallback: async () => on,
    });

    await apty.files({ tabId: 1 }, "ext", ["workflow.json"]);
    on = true;
    const read = await apty.files({ tabId: 1 }, "ext", ["workflow.json"]);

    expect(read.fromCdn).toBe(true);
    expect(cdn).toHaveBeenCalledTimes(1);
  });

  it("reads the CDN when the connected Client has no record of the named files for this tab", async () => {
    const cdn = vi.fn(() => cdnWith([{ name: "Export" }]));
    const apty = createAptyFiles({
      clientFiles: async () => answeredEmpty,
      cdn,
    });

    const read = await apty.files({ tabId: 3 }, "ext", ["workflow.json"]);

    expect(cdn).toHaveBeenCalledWith(3, ["workflow.json"], {
      storedChats: false,
    });
    expect(read.fromCdn).toBe(true);
    expect(read.files["workflow.json"]?.status).toBe("ok");
  });

  it("keeps the empty Client's answer when the CDN has nothing either", async () => {
    const apty = createAptyFiles({
      clientFiles: async () => answeredEmpty,
      cdn: () => ({
        ...cdnWith([]),
        listResources: async () => ({ ok: true, resources: [] }),
      }),
    });

    expect(await apty.files({ tabId: 3 }, "ext", ["workflow.json"])).toBe(
      answeredEmpty,
    );
  });

  it("does not read the 5.x-only CDN when the Client's record shows a 4.x tenant", async () => {
    const cdn = vi.fn(() => cdnWith([]));
    const fourX: ClientEvidence = {
      ...answeredEmpty,
      observedNames: ["flow.json", "app-urls.json"],
    };
    const apty = createAptyFiles({ clientFiles: async () => fourX, cdn });

    expect(await apty.files({ tabId: 3 }, "ext", ["workflow.json"])).toBe(
      fourX,
    );
    expect(cdn).not.toHaveBeenCalled();
  });

  it("reads only the Client without a tab", async () => {
    const cdn = vi.fn(() => cdnWith([]));
    const apty = createAptyFiles({ clientFiles: async () => silent, cdn });

    expect(await apty.files({}, "ext", ["rule.json"])).toBe(silent);
    expect(cdn).not.toHaveBeenCalled();
  });
});

describe("the page's network capture (KB-RAG K15)", () => {
  const FLOWS = "https://cdn.apty.example/tenant-t/app-a/env-e/flow.json";
  const captured = () => ({
    resources: [
      {
        requestId: "p1",
        url: FLOWS,
        method: "GET",
        status: 200,
        timestamp: 1,
        hasBody: true,
      },
    ],
    bodies: new Map([["p1", JSON.stringify([{ id: 1, name: { 1: "x" } }])]]),
  });

  it("reads the files from the tab's capture when the Client does not answer, before the CDN, and says so", async () => {
    const cdn = vi.fn(() => cdnWith([]));
    const apty = createAptyFiles({
      clientFiles: async () => silent,
      capture: (tab) => (tab === 7 ? captured() : undefined),
      cdn,
    });
    const evidence = await apty.files({ tabId: 7 }, undefined, ["flow.json"]);
    expect(evidence.fromCapture).toBe(true);
    expect(evidence.files["flow.json"]).toMatchObject({ status: "ok" });
    expect(cdn).not.toHaveBeenCalled();
  });

  it("goes on to the CDN when the capture holds no Apty call, and keeps the Client's files when it answers", async () => {
    const empty = createAptyFiles({
      clientFiles: async () => silent,
      capture: () => ({ resources: [], bodies: new Map() }),
      cdn: () => cdnWith([]),
    });
    const evidence = await empty.files({ tabId: 7 }, undefined, [
      "workflow.json",
    ]);
    expect(evidence.fromCapture).toBeUndefined();
    expect(evidence.fromCdn).toBe(true);
    const client = createAptyFiles({
      clientFiles: async () => answered,
      capture: () => captured(),
    });
    expect(await client.files({ tabId: 7 }, "ext", ["flow.json"])).toBe(
      answered,
    );
  });
});
