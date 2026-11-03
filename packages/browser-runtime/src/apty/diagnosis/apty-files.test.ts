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
  observedNames: [],
  files: {},
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

  it("reads only the Client without a tab", async () => {
    const cdn = vi.fn(() => cdnWith([]));
    const apty = createAptyFiles({ clientFiles: async () => silent, cdn });

    expect(await apty.files({}, "ext", ["rule.json"])).toBe(silent);
    expect(cdn).not.toHaveBeenCalled();
  });
});
