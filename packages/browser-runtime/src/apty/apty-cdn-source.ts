/**
 * Apty's content files and stored Ask Dapty chats, read from the tenant's
 * public content CDN the way the Apty Client reads them, for a Client that
 * does not report its own calls (every Client today in Extension mode).
 *
 * How the Client finds them (aptyInc/apty-dap, development, read only):
 * - Extension mode: `player-config.json`, a web-accessible resource, holds
 *   `contentURL` and `tenantId` (player `config/config.ts`, `wxt.config.ts`),
 *   and the Client injects `chrome-extension://<id>/window-script.js` into
 *   every page (`main-content-script/inject-custom-script.ts`), which names
 *   its extension ID. Injected mode: the page sets
 *   `window.__APTY_PLAYER_CONFIG__`.
 * - Paths are `tenant-{t}[/app-{a}[/env-{e}]]/{file}` (`cdn-path.builder.ts`),
 *   read with `?timestamp=` and no credentials.
 * - The application and environment are the first, by order, whose URL
 *   pattern matches the page (`cdn.service.ts` `getActiveIds`).
 * - Stored chats are `users/{userId}/widget-chat/chat-list.json` and
 *   `{chatId}.json` under the application (`widget-chat-storage.service.ts`).
 *   The user ID is the page value `app-data.json`'s
 *   `config.userIdentificationConfig` names, or an Apty ID the Client keeps in
 *   its own extension storage, which no other extension can read
 *   (`user-tracking.service.ts`).
 *
 * It is a `ResourceSource`, so every body goes through the same deny list and
 * redaction as the Client's record.
 */

import type { ResourceSource } from "./diagnosis/loader.js";
import { patternMatches } from "./diagnosis/url-patterns.js";
import type {
  AptyObservedResource,
  AptyResourceBody,
  AptyResourceList,
} from "./types.js";

interface AptyPageConfig {
  mode: "injected" | "extension";
  contentURL: string;
  tenantId: string;
  pageUrl: string;
  /** The Apty Client's extension ID, in Extension mode. */
  clientExtensionId?: string;
}

export type AptyPageProbe =
  | { ok: true; config: AptyPageConfig }
  | { ok: false; reason: "no-apty" | "no-config" | "not-readable" };

type PageUserSource =
  | "WindowStorage"
  | "SessionStorage"
  | "LocalStorage"
  | "Augmentation";

/** What the source reads from the tab; `chrome.scripting` by default. */
export interface AptyPage {
  probe(): Promise<AptyPageProbe>;
  /** The value the application identifies its user by, as the page holds it. */
  userValue(source: PageUserSource, key: string): Promise<string | undefined>;
}

/** Why no stored chat was read. */
export type StoredChatState =
  | "read"
  | "apty-id"
  | "no-user-value"
  | "no-chats"
  | "not-requested";

export interface CdnResourceSource extends ResourceSource {
  /** Apty as the page showed it, or why it was not found. */
  probe(): Promise<AptyPageProbe>;
  storedChat(): Promise<StoredChatState>;
}

const TENANT_FILES = new Set(["app-urls.json", "content-config.json"]);
const APP_FILES = new Set(["app-data.json", "application-locales.json"]);
/** @internal */
export const MAX_CDN_BODY_CHARS = 5_000_000;
const USER_SOURCES: ReadonlySet<string> = new Set<PageUserSource>([
  "WindowStorage",
  "SessionStorage",
  "LocalStorage",
  "Augmentation",
]);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** A content URL the source may call: https, or http on this machine (tests). */
function usableBase(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const local =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
      return undefined;
    return url.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/** A path segment the Client would put in a URL as is: no separator or query in it. */
const PATH_SAFE = /^[^/?#\\\s]{1,256}$/;

/**
 * The application and environment the player picks for the page: the first
 * application whose environments match, then its first environment by
 * order. Wildcard patterns, as with the regex URL flags off (the default).
 * @internal
 */
export function activeIds(
  appUrls: unknown,
  pageUrl: string,
): { appId: string; envId: string } | undefined {
  if (!Array.isArray(appUrls)) return undefined;
  for (const app of appUrls) {
    if (!isRec(app) || !str(app.id) || !Array.isArray(app.environments))
      continue;
    const envs = app.environments
      .filter(isRec)
      .filter((env) => str(env.id))
      .sort(
        (a, b) =>
          (typeof a.order === "number" ? a.order : Number.MAX_VALUE) -
          (typeof b.order === "number" ? b.order : Number.MAX_VALUE),
      );
    const env = envs.find(
      (e) =>
        Array.isArray(e.urls) &&
        e.urls.some(
          (p: unknown) => typeof p === "string" && patternMatches(p, pageUrl),
        ),
    );
    if (env) return { appId: app.id as string, envId: env.id as string };
  }
  return undefined;
}

/** The newest chat in a `chat-list.json`. @internal */
export function newestChatId(list: unknown): string | undefined {
  if (!isRec(list) || !Array.isArray(list.chats)) return undefined;
  let newest: { id: string; at: number } | undefined;
  for (const chat of list.chats) {
    if (!isRec(chat) || !str(chat.id) || !PATH_SAFE.test(chat.id as string))
      continue;
    const at = Date.parse(String(chat.lastUpdate ?? ""));
    const time = Number.isNaN(at) ? 0 : at;
    if (!newest || time >= newest.at)
      newest = { id: chat.id as string, at: time };
  }
  return newest?.id;
}

function userIdentification(
  appData: unknown,
): { source: PageUserSource; key: string } | "apty-id" {
  const config = isRec(appData) && isRec(appData.config) ? appData.config : {};
  const ident = isRec(config.userIdentificationConfig)
    ? config.userIdentificationConfig
    : {};
  const type = str(ident.type);
  const key = str(ident.value);
  if (!type || !key || !USER_SOURCES.has(type)) return "apty-id";
  return { source: type as PageUserSource, key };
}

export interface CdnSourceOptions {
  page: AptyPage;
  /** The content files to read, by name. */
  files: readonly string[];
  /** Also read the newest stored Ask Dapty chat, when the user ID is on the page. */
  storedChats?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface Loaded {
  list: AptyResourceList;
  bodies: Map<string, AptyResourceBody>;
  probe: AptyPageProbe;
  storedChat: StoredChatState;
}

export function createCdnResourceSource({
  page,
  files,
  storedChats = false,
  fetchImpl = (input, init) => fetch(input, init),
  now = Date.now,
}: CdnSourceOptions): CdnResourceSource {
  let loading: Promise<Loaded> | undefined;

  async function load(): Promise<Loaded> {
    const bodies = new Map<string, AptyResourceBody>();
    const resources: AptyObservedResource[] = [];
    const probe = await page
      .probe()
      .catch((): AptyPageProbe => ({ ok: false, reason: "not-readable" }));
    const base = probe.ok ? usableBase(probe.config.contentURL) : undefined;
    if (!probe.ok || !base || !PATH_SAFE.test(probe.config.tenantId)) {
      return {
        list: {
          ok: false,
          resources: [],
          failure: "no_receiver",
          error: probe.ok ? "unusable-config" : probe.reason,
        },
        bodies,
        probe: probe.ok ? { ok: false, reason: "no-config" } : probe,
        storedChat: storedChats ? "no-chats" : "not-requested",
      };
    }
    const { config } = probe;
    const started = now();

    const get = async (path: string): Promise<unknown> => {
      const requestId = `cdn-${resources.length + 1}`;
      const url = `${base}/${path}?timestamp=${started}`;
      const resource: AptyObservedResource = {
        requestId,
        url,
        method: "GET",
        timestamp: started + resources.length + 1,
      };
      resources.push(resource);
      let text: string;
      try {
        const response = await fetchImpl(url, {
          credentials: "omit",
          cache: "no-store",
        });
        resource.status = response.status;
        resource.mimeType =
          response.headers.get("content-type") ?? "application/json";
        text = await response.text();
        if (!response.ok) {
          bodies.set(requestId, {
            found: true,
            body: text,
            base64Encoded: false,
          });
          resource.hasBody = true;
          return undefined;
        }
      } catch (error) {
        resource.failed = true;
        resource.status = 0;
        resource.errorText =
          error instanceof Error ? error.message : "The request failed";
        return undefined;
      }
      if (text.length > MAX_CDN_BODY_CHARS) {
        bodies.set(requestId, { found: false, reason: "too-large" });
        resource.hasBody = false;
        return undefined;
      }
      bodies.set(requestId, { found: true, body: text, base64Encoded: false });
      resource.hasBody = true;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    };

    const tenant = `tenant-${config.tenantId}`;
    const appUrls = await get(`${tenant}/app-urls.json`);
    const ids = activeIds(appUrls, config.pageUrl);
    let appData: unknown;
    if (ids) {
      const app = `${tenant}/app-${ids.appId}`;
      const env = `${app}/env-${ids.envId}`;
      for (const name of files) {
        if (name === "app-urls.json") continue;
        const scope = TENANT_FILES.has(name)
          ? tenant
          : APP_FILES.has(name)
            ? app
            : env;
        const json = await get(`${scope}/${name}`);
        if (name === "app-data.json") appData = json;
      }
    }

    let storedChat: StoredChatState = storedChats
      ? "no-chats"
      : "not-requested";
    if (storedChats && ids) {
      appData ??= await get(`${tenant}/app-${ids.appId}/app-data.json`);
      const ident = userIdentification(appData);
      if (ident === "apty-id") {
        storedChat = "apty-id";
      } else {
        const user = await page
          .userValue(ident.source, ident.key)
          .catch(() => undefined);
        if (!user || !PATH_SAFE.test(user)) {
          storedChat = "no-user-value";
        } else {
          const chats = `${tenant}/app-${ids.appId}/users/${user}/widget-chat`;
          const chatId = newestChatId(await get(`${chats}/chat-list.json`));
          if (chatId && (await get(`${chats}/${chatId}.json`)) !== undefined) {
            storedChat = "read";
          }
        }
      }
    }
    return { list: { ok: true, resources }, bodies, probe, storedChat };
  }

  const loaded = () => {
    loading ??= load();
    return loading;
  };

  return {
    async listResources() {
      return (await loaded()).list;
    },
    async getResourceBody(requestId) {
      return (
        (await loaded()).bodies.get(requestId) ?? {
          found: false,
          reason: "none",
        }
      );
    },
    async probe() {
      return (await loaded()).probe;
    },
    async storedChat() {
      return (await loaded()).storedChat;
    },
  };
}

/**
 * Runs in the tab's isolated world (self-contained: `chrome.scripting` sends
 * only its source). The Client's extension ID from the script it injects,
 * then its web-accessible `player-config.json`.
 * @internal
 */
export async function probeClientInPage(): Promise<
  | { found: false }
  | { found: true; id: string; config?: Record<string, unknown> }
> {
  const pattern =
    /^chrome-extension:\/\/([a-p]{32})\/window-script\.js(?:[?#]|$)/;
  const urls = [
    ...performance.getEntriesByType("resource").map((e) => e.name),
    ...Array.from(
      document.querySelectorAll("script[src]"),
      (s) => s.getAttribute("src") ?? "",
    ),
  ];
  const id = urls.map((u) => pattern.exec(u)?.[1]).find(Boolean);
  if (!id) return { found: false };
  try {
    const response = await fetch(`chrome-extension://${id}/player-config.json`);
    const config = (await response.json()) as unknown;
    return typeof config === "object" && config !== null
      ? { found: true, id, config: config as Record<string, unknown> }
      : { found: true, id };
  } catch {
    return { found: true, id };
  }
}

/**
 * Runs in the page's main world: the injected player's config, when the page
 * set one. Only the two fields the source needs leave the page.
 * @internal
 */
export function probeInjectedConfigInPage(): {
  contentURL?: unknown;
  tenantId?: unknown;
} | null {
  const raw = (window as unknown as { __APTY_PLAYER_CONFIG__?: unknown })
    .__APTY_PLAYER_CONFIG__;
  if (typeof raw !== "object" || raw === null) return null;
  const { contentURL, tenantId } = raw as Record<string, unknown>;
  return { contentURL, tenantId };
}

/**
 * Runs in the page's main world: the value the Client reads for the user
 * (`window-ipc-handles.service.ts`: a dotted window path, a storage key, or
 * a key of `window.aptyAugmentation`). Strings only.
 * @internal
 */
export function readUserValueInPage(
  source: string,
  key: string,
): string | undefined {
  let value: unknown;
  if (source === "SessionStorage") value = sessionStorage.getItem(key);
  else if (source === "LocalStorage") value = localStorage.getItem(key);
  else if (source === "Augmentation") {
    const augmentation = (window as unknown as Record<string, unknown>)
      .aptyAugmentation;
    value =
      typeof augmentation === "object" && augmentation !== null
        ? (augmentation as Record<string, unknown>)[key]
        : undefined;
  } else {
    value = key
      .split(".")
      .reduce<unknown>(
        (acc, part) =>
          typeof acc === "object" && acc !== null
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        window,
      );
  }
  return typeof value === "string" && value.length <= 256 ? value : undefined;
}

async function run<T>(
  tabId: number,
  world: "MAIN" | "ISOLATED",
  func: (...args: string[]) => T | Promise<T>,
  args: string[] = [],
): Promise<T | undefined> {
  const [first] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world,
    func,
    args,
  });
  return first?.result as T | undefined;
}

/** The tab's top frame through `chrome.scripting`. */
export function tabAptyPage(tabId: number): AptyPage {
  return {
    async probe() {
      try {
        const tab = await chrome.tabs.get(tabId);
        const pageUrl = tab.url ?? "";
        const injected = await run(tabId, "MAIN", probeInjectedConfigInPage);
        if (injected) {
          const contentURL = str(injected.contentURL);
          const tenantId = str(injected.tenantId);
          return contentURL && tenantId
            ? {
                ok: true,
                config: { mode: "injected", contentURL, tenantId, pageUrl },
              }
            : { ok: false, reason: "no-config" };
        }
        const client = await run(tabId, "ISOLATED", probeClientInPage);
        if (!client?.found) return { ok: false, reason: "no-apty" };
        const contentURL = str(client.config?.contentURL);
        const tenantId = str(client.config?.tenantId);
        if (!contentURL || !tenantId) return { ok: false, reason: "no-config" };
        return {
          ok: true,
          config: {
            mode: "extension",
            contentURL,
            tenantId,
            pageUrl,
            clientExtensionId: client.id,
          },
        };
      } catch {
        return { ok: false, reason: "not-readable" };
      }
    },
    async userValue(source, key) {
      try {
        return await run(tabId, "MAIN", readUserValueInPage, [source, key]);
      } catch {
        return undefined;
      }
    },
  };
}

/** The Apty Client's extension ID as the page shows it, for a Client nobody configured. */
export async function detectClientExtensionId(
  tabId: number,
): Promise<string | undefined> {
  try {
    const client = await run(tabId, "ISOLATED", probeClientInPage);
    return client?.found ? client.id : undefined;
  } catch {
    return undefined;
  }
}
