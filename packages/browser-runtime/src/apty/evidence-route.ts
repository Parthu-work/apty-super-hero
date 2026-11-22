/**
 * "Get the evidence" (KB-RAG K27, E8): when a check read no Apty file, one
 * button picks how to get them. In Injected mode the page makes Apty's
 * content calls, so a capture of the tab while it reloads holds them; in
 * Extension mode the Apty Client's service worker makes them, so the SE
 * saves a HAR there. The mode comes from what the page and the Client show:
 * the injected player's config, the script the Client's manifest makes
 * web-accessible and injects, the page's own content calls, or the Client
 * answering for its calls. The route the SE last took on a site is kept on
 * the device under the site's key, never its host.
 */

export type ClientMode = "extension" | "injected";

/** What showed the mode. */
export type ClientModeSource =
  | "player-config"
  | "client-script"
  | "page-calls"
  | "client-calls";

export interface DetectedClientMode {
  mode: ClientMode;
  from: ClientModeSource;
}

export interface ClientModeFacts {
  /** The page set the injected player's config. */
  injectedConfig: boolean;
  /** The page holds the script the Client injects from its extension. */
  clientScript: boolean;
  /** Apty content files the page itself fetched. */
  pageContentCalls: number;
  /** The Apty Client's service worker answered for its own calls. */
  clientAnswered: boolean;
}

export type EvidenceRoute = "capture" | "har";

/** The page's signs before the Client's; undefined when nothing shows a mode. */
export function clientModeOf(
  facts: ClientModeFacts,
): DetectedClientMode | undefined {
  if (facts.injectedConfig) return { mode: "injected", from: "player-config" };
  if (facts.clientScript) return { mode: "extension", from: "client-script" };
  if (facts.pageContentCalls > 0) {
    return { mode: "injected", from: "page-calls" };
  }
  if (facts.clientAnswered) return { mode: "extension", from: "client-calls" };
  return undefined;
}

/**
 * The routes a site's Apty version allows (KB-RAG K29, B4): the HAR from
 * the Client's service worker is the 4.x route, so a 5.x site is offered a
 * capture only; an unknown version keeps both.
 */
export function evidenceRoutesFor(
  version: "4.x" | "5.x" | "unknown",
): readonly EvidenceRoute[] {
  return version === "5.x" ? ["capture"] : ["capture", "har"];
}

/** The user's last route on the site, else the detected mode's, else a capture; only a route the version allows. */
export function evidenceRouteOf(
  detected: DetectedClientMode | undefined,
  remembered: EvidenceRoute | undefined,
  version: "4.x" | "5.x" | "unknown" = "unknown",
): { route: EvidenceRoute; why: "remembered" | "detected" | "default" } {
  if (!evidenceRoutesFor(version).includes("har")) {
    return { route: "capture", why: "detected" };
  }
  if (remembered) return { route: remembered, why: "remembered" };
  if (detected) {
    return {
      route: detected.mode === "extension" ? "har" : "capture",
      why: "detected",
    };
  }
  return { route: "capture", why: "default" };
}

/**
 * Runs in the tab's main world (self-contained: `chrome.scripting` sends
 * only its source). Only two flags and a count leave the page.
 * @internal exported for tests
 */
export function clientModeInPage(): Omit<ClientModeFacts, "clientAnswered"> {
  const clientScript =
    /^chrome-extension:\/\/[a-p]{32}\/window-script\.js(?:[?#]|$)/;
  const contentFile = /\/tenant-[^/?#]+\/(?:[^?#]*\/)?[\w.-]+\.json(?:[?#]|$)/i;
  const config = (window as unknown as { __APTY_PLAYER_CONFIG__?: unknown })
    .__APTY_PLAYER_CONFIG__;
  const resources = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name);
  const scripts = Array.from(
    document.querySelectorAll("script[src]"),
    (script) => script.getAttribute("src") ?? "",
  );
  return {
    injectedConfig: typeof config === "object" && config !== null,
    clientScript: [...resources, ...scripts].some((url) =>
      clientScript.test(url),
    ),
    pageContentCalls: resources.filter((url) => contentFile.test(url)).length,
  };
}

/** The page's signs in the tab's top frame, or undefined when it cannot be read. */
export async function tabClientModeFacts(
  tabId: number,
): Promise<Omit<ClientModeFacts, "clientAnswered"> | undefined> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: clientModeInPage,
    });
    const result = first?.result as Record<string, unknown> | undefined;
    if (!result) return undefined;
    return {
      injectedConfig: result.injectedConfig === true,
      clientScript: result.clientScript === true,
      pageContentCalls:
        typeof result.pageContentCalls === "number"
          ? result.pageContentCalls
          : 0,
    };
  } catch {
    return undefined;
  }
}

const ROUTES_KEY = "apty_evidence_routes";
const MAX_SITES = 100;

async function readRoutes(): Promise<Record<string, EvidenceRoute>> {
  try {
    const items = await chrome.storage.local.get(ROUTES_KEY);
    const raw = items?.[ROUTES_KEY];
    if (typeof raw !== "object" || raw === null) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, EvidenceRoute] =>
          entry[1] === "capture" || entry[1] === "har",
      ),
    );
  } catch {
    return {};
  }
}

export async function rememberedRoute(
  siteKey: string | undefined,
): Promise<EvidenceRoute | undefined> {
  if (!siteKey) return undefined;
  return (await readRoutes())[siteKey];
}

/** Keeps `route` as the site's last, newest last, at most 100 sites. */
export async function rememberRoute(
  siteKey: string | undefined,
  route: EvidenceRoute,
): Promise<void> {
  if (!siteKey) return;
  const routes = await readRoutes();
  delete routes[siteKey];
  routes[siteKey] = route;
  const kept = Object.entries(routes).slice(-MAX_SITES);
  try {
    await chrome.storage.local.set({ [ROUTES_KEY]: Object.fromEntries(kept) });
  } catch {
    // Not remembered; the next visit detects the mode again.
  }
}
