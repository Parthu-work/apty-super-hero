// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: stored.value[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(stored.value, items);
      }),
    },
  },
};

import {
  type ClientModeFacts,
  clientModeInPage,
  clientModeOf,
  evidenceRouteOf,
  rememberedRoute,
  rememberRoute,
} from "./evidence-route";

const NONE: ClientModeFacts = {
  injectedConfig: false,
  clientScript: false,
  pageContentCalls: 0,
  clientAnswered: false,
};

describe("which mode the Apty Client runs in (KB-RAG K27, E8)", () => {
  it("is Injected when the page sets the player config, whatever else it shows", () => {
    expect(
      clientModeOf({
        ...NONE,
        injectedConfig: true,
        clientScript: true,
        clientAnswered: true,
      }),
    ).toEqual({ mode: "injected", from: "player-config" });
  });

  it("is Extension when the page holds the Client's injected script", () => {
    expect(
      clientModeOf({ ...NONE, clientScript: true, pageContentCalls: 3 }),
    ).toEqual({ mode: "extension", from: "client-script" });
  });

  it("is Injected when the page itself fetched Apty content files", () => {
    expect(
      clientModeOf({ ...NONE, pageContentCalls: 2, clientAnswered: true }),
    ).toEqual({ mode: "injected", from: "page-calls" });
  });

  it("is Extension when only the Client's service worker answers", () => {
    expect(clientModeOf({ ...NONE, clientAnswered: true })).toEqual({
      mode: "extension",
      from: "client-calls",
    });
  });

  it("is unknown with no sign of either", () => {
    expect(clientModeOf(NONE)).toBeUndefined();
  });
});

describe("the route Get the evidence takes (KB-RAG K27, E8)", () => {
  it("captures the page in Injected mode and asks for a service-worker HAR in Extension mode", () => {
    expect(
      evidenceRouteOf({ mode: "injected", from: "page-calls" }, undefined),
    ).toEqual({ route: "capture", why: "detected" });
    expect(
      evidenceRouteOf({ mode: "extension", from: "client-script" }, undefined),
    ).toEqual({ route: "har", why: "detected" });
  });

  it("keeps the route the user last took on the site over the detected one", () => {
    expect(
      evidenceRouteOf({ mode: "injected", from: "page-calls" }, "har"),
    ).toEqual({ route: "har", why: "remembered" });
  });

  it("tries a capture when nothing is known", () => {
    expect(evidenceRouteOf(undefined, undefined)).toEqual({
      route: "capture",
      why: "default",
    });
  });
});

describe("the route remembered per site (KB-RAG K27, E8)", () => {
  beforeEach(() => {
    stored.value = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is kept on the device by site key, never by host", async () => {
    await rememberRoute("site-0000beef", "har");
    expect(await rememberedRoute("site-0000beef")).toBe("har");
    expect(await rememberedRoute("site-00000001")).toBeUndefined();
    expect(JSON.stringify(stored.value)).not.toMatch(/\./);
  });

  it("ignores a stored value that is not a route", async () => {
    stored.value = {
      apty_evidence_routes: { "site-0000beef": "upload", other: 3 },
    };
    expect(await rememberedRoute("site-0000beef")).toBeUndefined();
  });

  it("keeps at most 100 sites, dropping the oldest", async () => {
    for (let i = 0; i < 101; i += 1) {
      await rememberRoute(`site-${i.toString(16).padStart(8, "0")}`, "har");
    }
    const routes = stored.value.apty_evidence_routes as Record<string, string>;
    expect(Object.keys(routes)).toHaveLength(100);
    expect(await rememberedRoute("site-00000000")).toBeUndefined();
    expect(await rememberedRoute("site-00000064")).toBe("har");
  });

  it("answers undefined when storage cannot be read", async () => {
    const local = (
      globalThis as unknown as {
        chrome: { storage: { local: { get: ReturnType<typeof vi.fn> } } };
      }
    ).chrome.storage.local;
    local.get.mockRejectedValueOnce(new Error("gone"));
    expect(await rememberedRoute("site-0000beef")).toBeUndefined();
  });
});

describe("the page's signs, read in the tab (KB-RAG K27, E8)", () => {
  afterEach(() => {
    delete (window as { __APTY_PLAYER_CONFIG__?: unknown })
      .__APTY_PLAYER_CONFIG__;
    document.head.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("finds the player config, the Client's script and the page's own content calls", () => {
    (window as { __APTY_PLAYER_CONFIG__?: unknown }).__APTY_PLAYER_CONFIG__ = {
      contentURL: "https://cdn.example",
      tenantId: "t",
    };
    const script = document.createElement("script");
    script.src = `chrome-extension://${"a".repeat(32)}/window-script.js`;
    document.head.appendChild(script);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "https://cdn.example/tenant-t/app-a/env-e/flow.json?x=1" },
      { name: "https://cdn.example/tenant-t/app-urls.json" },
      { name: "https://app.example/api/flow.json" },
      { name: "https://cdn.example/tenant-t/logo.png" },
    ] as PerformanceEntry[]);
    expect(clientModeInPage()).toEqual({
      injectedConfig: true,
      clientScript: true,
      pageContentCalls: 2,
    });
  });

  it("reports nothing on a page without Apty", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    expect(clientModeInPage()).toEqual({
      injectedConfig: false,
      clientScript: false,
      pageContentCalls: 0,
    });
  });
});
