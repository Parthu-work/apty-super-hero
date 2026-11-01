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

import { resetRedactionModeForTests } from "../runtime/redaction-mode";
import {
  type AptyPage,
  type AptyPageProbe,
  activeIds,
  createCdnResourceSource,
  MAX_CDN_BODY_CHARS,
  newestChatId,
} from "./apty-cdn-source";
import { DAPTY_FILES } from "./diagnosis/dapty-conversation";
import { loadDaptyFrom } from "./diagnosis/dapty-loader";
import { loadEvidenceFrom } from "./diagnosis/loader";

const CDN = "https://client.apty.example";
const TENANT = "0f000000-0000-7000-8000-000000000000";
const APP = "0a000000-0000-7000-8000-000000000001";
const ENV = "0e000000-0000-7000-8000-000000000002";
const T = `${CDN}/tenant-${TENANT}`;
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

const appData = (ident?: Record<string, unknown>) => ({
  id: APP,
  config: {
    widgetConfig: { features: { aiAssistant: true } },
    ...(ident ? { userIdentificationConfig: ident } : {}),
  },
});

const STORED = {
  id: "0197aaaa-0000-7000-8000-000000000002",
  name: "Reports",
  messages: [
    {
      id: "m1",
      role: "user",
      content: "Where are reports? jane.doe@example.com",
    },
    {
      id: "m2",
      role: "assistant",
      content: "Try this.",
      suggestions: [{ id: "0c05", name: "Export a report", type: "workflow" }],
    },
  ],
};

function cdn(files: Record<string, unknown>) {
  const requested: string[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.credentials).toBe("omit");
      requested.push(url.replace(/\?timestamp=\d+$/, ""));
      const path = url.replace(/\?timestamp=\d+$/, "");
      if (!(path in files)) return new Response("missing", { status: 404 });
      const body = files[path];
      if (body instanceof Error) throw body;
      return new Response(
        typeof body === "string" ? body : JSON.stringify(body),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  ) as unknown as typeof fetch;
  return { fetchImpl, requested };
}

function page(
  probe: AptyPageProbe = {
    ok: true,
    config: {
      mode: "extension",
      contentURL: CDN,
      tenantId: TENANT,
      pageUrl: PAGE,
      clientExtensionId: "a".repeat(32),
    },
  },
  user?: string,
): AptyPage & { userValue: ReturnType<typeof vi.fn> } {
  return {
    probe: async () => probe,
    userValue: vi.fn(async () => user),
  };
}

const ENV_FILES = (extra: Record<string, unknown> = {}) => ({
  [`${T}/app-urls.json`]: APP_URLS,
  [`${T}/app-${APP}/app-data.json`]: appData(),
  [`${T}/app-${APP}/env-${ENV}/workflow.json`]: [{ name: "Export a report" }],
  [`${T}/app-${APP}/env-${ENV}/knowledge-content.json`]: [],
  [`${T}/app-${APP}/env-${ENV}/rule.json`]: [],
  ...extra,
});

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("activeIds", () => {
  it("picks the first application, then its first environment by order, whose pattern matches", () => {
    expect(activeIds(APP_URLS, PAGE)).toEqual({ appId: APP, envId: ENV });
    expect(activeIds(APP_URLS, "https://crm.example.com/x")).toEqual({
      appId: APP,
      envId: "prod",
    });
    expect(activeIds(APP_URLS, "https://other.example.com/")).toBeUndefined();
    expect(activeIds({ not: "a list" }, PAGE)).toBeUndefined();
  });
});

describe("newestChatId", () => {
  it("takes the chat updated last, and skips an id that is not a plain path segment", () => {
    expect(
      newestChatId({
        chats: [
          { id: "old", lastUpdate: "2026-10-01T00:00:00Z" },
          { id: "../evil", lastUpdate: "2026-12-01T00:00:00Z" },
          { id: "new", lastUpdate: "2026-10-31T00:00:00Z" },
        ],
      }),
    ).toBe("new");
    expect(newestChatId({ chats: [] })).toBeUndefined();
  });
});

describe("createCdnResourceSource", () => {
  it("reads the content files at the tenant, application and environment paths the Client uses", async () => {
    const { fetchImpl, requested } = cdn(ENV_FILES());
    const source = createCdnResourceSource({
      page: page(),
      files: DAPTY_FILES,
      fetchImpl,
    });

    const evidence = await loadEvidenceFrom(source, DAPTY_FILES);

    expect(requested).toEqual([
      `${T}/app-urls.json`,
      `${T}/app-${APP}/app-data.json`,
      `${T}/app-${APP}/env-${ENV}/workflow.json`,
      `${T}/app-${APP}/env-${ENV}/knowledge-content.json`,
      `${T}/app-${APP}/env-${ENV}/rule.json`,
    ]);
    expect(evidence.connection).toEqual({ ok: true });
    expect(evidence.envId).toBe(`env-${ENV}`);
    expect(evidence.files["workflow.json"]?.status).toBe("ok");
    expect(evidence.files["knowledge-content.json"]?.status).toBe("empty");
  });

  it("reads the newest stored chat, with its suggestions' ids, when the page holds the user's ID", async () => {
    const chats = `${T}/app-${APP}/users/u-7/widget-chat`;
    const { fetchImpl, requested } = cdn(
      ENV_FILES({
        [`${T}/app-${APP}/app-data.json`]: appData({
          type: "WindowStorage",
          value: "user.id",
        }),
        [`${chats}/chat-list.json`]: {
          chats: [{ id: STORED.id, lastUpdate: "2026-10-31T00:00:00Z" }],
        },
        [`${chats}/${STORED.id}.json`]: STORED,
      }),
    );
    const tab = page(undefined, "u-7");
    const source = createCdnResourceSource({
      page: tab,
      files: DAPTY_FILES,
      storedChats: true,
      fetchImpl,
    });

    const evidence = await loadDaptyFrom(source, "cdn");

    expect(tab.userValue).toHaveBeenCalledWith("WindowStorage", "user.id");
    expect(requested).toContain(`${chats}/${STORED.id}.json`);
    expect(await source.storedChat()).toBe("read");
    expect(evidence.source).toBe("cdn");
    expect(evidence.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(evidence.turns[0]?.text).not.toContain("jane.doe@example.com");
    expect(evidence.turns[1]?.suggestions).toEqual([
      { id: "0c05", name: "Export a report", type: "workflow" },
    ]);
  });

  it("asks nothing of the page and fetches no chat when users are known by an Apty ID only the Client holds", async () => {
    const { fetchImpl, requested } = cdn(ENV_FILES());
    const tab = page();
    const source = createCdnResourceSource({
      page: tab,
      files: DAPTY_FILES,
      storedChats: true,
      fetchImpl,
    });

    await source.listResources();

    expect(await source.storedChat()).toBe("apty-id");
    expect(tab.userValue).not.toHaveBeenCalled();
    expect(requested.some((u) => u.includes("/widget-chat/"))).toBe(false);
  });

  it("fetches no chat for a user value that is missing or would change the path", async () => {
    const files = ENV_FILES({
      [`${T}/app-${APP}/app-data.json`]: appData({
        type: "LocalStorage",
        value: "uid",
      }),
    });
    for (const user of [undefined, "../../other-tenant"]) {
      const { fetchImpl, requested } = cdn(files);
      const source = createCdnResourceSource({
        page: page(undefined, user),
        files: DAPTY_FILES,
        storedChats: true,
        fetchImpl,
      });
      await source.listResources();
      expect(await source.storedChat()).toBe("no-user-value");
      expect(requested.some((u) => u.includes("/widget-chat/"))).toBe(false);
    }
  });

  it("withholds the stored chat's body when /widget-chat/ is on the body deny list", async () => {
    settings.value = {
      redactionMode: "strict",
      networkBodyCaptureDenyList: ["/widget-chat/"],
    };
    resetRedactionModeForTests();
    const chats = `${T}/app-${APP}/users/u-7/widget-chat`;
    const { fetchImpl } = cdn(
      ENV_FILES({
        [`${T}/app-${APP}/app-data.json`]: appData({
          type: "SessionStorage",
          value: "uid",
        }),
        [`${chats}/chat-list.json`]: { chats: [{ id: STORED.id }] },
        [`${chats}/${STORED.id}.json`]: STORED,
      }),
    );

    const evidence = await loadDaptyFrom(
      createCdnResourceSource({
        page: page(undefined, "u-7"),
        files: DAPTY_FILES,
        storedChats: true,
        fetchImpl,
      }),
      "cdn",
    );

    expect(evidence.turns).toEqual([]);
  });

  it("reads a workflow's steps file at the environment, and never a name that would change the path", async () => {
    const { fetchImpl, requested } = cdn(
      ENV_FILES({ [`${T}/app-${APP}/env-${ENV}/workflow-0c05.json`]: [] }),
    );
    const source = createCdnResourceSource({
      page: page(),
      files: ["workflow-0c05.json", "../../other-tenant/rule.json"],
      fetchImpl,
    });

    await source.listResources();

    expect(requested).toEqual([
      `${T}/app-urls.json`,
      `${T}/app-${APP}/env-${ENV}/workflow-0c05.json`,
    ]);
  });

  it("reports Apty as not found, and calls nothing, without a usable config", async () => {
    for (const probe of [
      { ok: false, reason: "no-apty" } as const,
      {
        ok: true,
        config: {
          mode: "injected",
          contentURL: "http://client.apty.example",
          tenantId: TENANT,
          pageUrl: PAGE,
        },
      } as const,
    ]) {
      const { fetchImpl } = cdn({});
      const source = createCdnResourceSource({
        page: page(probe),
        files: DAPTY_FILES,
        fetchImpl,
      });
      const evidence = await loadEvidenceFrom(source, DAPTY_FILES);
      expect(evidence.connection.ok).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("names a file whose request failed or whose body is too large, and fetches once for both readers", async () => {
    const { fetchImpl } = cdn(
      ENV_FILES({
        [`${T}/app-${APP}/env-${ENV}/workflow.json`]: new Error(
          "net::ERR_FAILED",
        ),
        [`${T}/app-${APP}/env-${ENV}/rule.json`]: "x".repeat(
          MAX_CDN_BODY_CHARS + 1,
        ),
      }),
    );
    const source = createCdnResourceSource({
      page: page(),
      files: DAPTY_FILES,
      fetchImpl,
    });

    const evidence = await loadEvidenceFrom(source, DAPTY_FILES);
    await loadDaptyFrom(source, "cdn");

    expect(evidence.files["workflow.json"]?.status).toBe("failed");
    expect(evidence.files["rule.json"]?.status).not.toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
