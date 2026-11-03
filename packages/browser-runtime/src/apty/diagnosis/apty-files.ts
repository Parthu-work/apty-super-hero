/**
 * Where every check reads Apty's content files for the conversation's tab:
 * the Apty Client's record, or Apty's public content CDN when the Client
 * does not report its calls (every Client today in Extension mode). The
 * Client is asked with the saved ID, or with the ID the page shows when that
 * Client answers at all.
 */

import { type AppSettings, STORAGE_KEYS } from "@apty/agent-core";
import { ChromeStorageAdapter } from "../../storage/storage-adapter.js";
import {
  type CdnResourceSource,
  createCdnResourceSource,
  detectClientExtensionId,
  tabAptyPage,
} from "../apty-cdn-source.js";
import { sendExternalMessageDetailed } from "../external-messaging.js";
import { loadClientEvidence, loadEvidenceFrom } from "./loader.js";
import type { ClientEvidence } from "./types.js";

export interface AptyFilesReaders {
  /** The Apty Client's ID as the tab's page shows it, when none is saved. */
  detectClient?: (tabId: number) => Promise<string | undefined>;
  /**
   * Whether a Client found on the page answers the Agent at all. The 5.x
   * Client takes every external message and never answers one it does not
   * know (`chrome-background-transport.ts`), so asking it would wait out
   * every timeout.
   */
  clientAnswers?: (extensionId: string) => Promise<boolean>;
  /** Apty's content CDN for a tab, reading the named files. */
  cdn?: (
    tabId: number,
    names: readonly string[],
    options: { storedChats: boolean },
  ) => CdnResourceSource;
  /**
   * Whether Apty's content CDN may be read when the Client does not answer
   * (Settings → Apty Integration). Off: no page probe for the Client's
   * config and no CDN request; the Client is still found and pinged.
   * Missing means on.
   */
  cdnFallback?: () => Promise<boolean>;
  /** Overridable for tests; the Apty Client's files by default. */
  clientFiles?: (
    extensionId: string | undefined,
    names: readonly string[],
  ) => Promise<ClientEvidence>;
}

export const tabOf = (runContext: unknown) => {
  const tabId = (runContext as { tabId?: unknown } | undefined)?.tabId;
  return typeof tabId === "number" ? tabId : undefined;
};

/** One CDN read per tab, file set and check run: the readers of one check share it. */
const CDN_REUSE_MS = 15_000;
/** How long a found Client's answer is trusted; silence for less, as a cold worker can miss the ping. */
const CLIENT_ANSWER_REUSE_MS = 5 * 60_000;
const CLIENT_SILENCE_REUSE_MS = 60_000;
const CLIENT_PING_MS = 1_500;

/**
 * The Client's own reason stays first (a 4.x Client puts no script on the
 * page, so it can only be reached by its saved ID).
 */
const withCdnUnread = (
  connection: Extract<ClientEvidence["connection"], { ok: false }>,
): ClientEvidence["connection"] => ({
  ...connection,
  message: `${connection.message} Apty's content CDN could not be read either: this page holds no Apty 5.x Client script or injected player config.`,
});

/** @internal */
export function createAptyFiles(readers: AptyFilesReaders) {
  const clientFiles = readers.clientFiles ?? loadClientEvidence;
  const cdnRuns = new Map<string, { at: number; source: CdnResourceSource }>();
  const answering = new Map<string, { until: number; ok: Promise<boolean> }>();

  async function cdnFor(
    tab: number | undefined,
    names: readonly string[],
    storedChats = false,
  ): Promise<CdnResourceSource | undefined> {
    if (tab === undefined || !readers.cdn) return undefined;
    const allowed = readers.cdnFallback
      ? await readers.cdnFallback().catch(() => true)
      : true;
    if (!allowed) return undefined;
    const key = `${tab}|${storedChats}|${[...names].sort().join(",")}`;
    const cached = cdnRuns.get(key);
    if (cached && Date.now() - cached.at < CDN_REUSE_MS) return cached.source;
    for (const [old, run] of cdnRuns) {
      if (Date.now() - run.at >= CDN_REUSE_MS) cdnRuns.delete(old);
    }
    const source = readers.cdn(tab, names, { storedChats });
    cdnRuns.set(key, { at: Date.now(), source });
    return source;
  }

  function answers(id: string): Promise<boolean> {
    if (!readers.clientAnswers) return Promise.resolve(true);
    const cached = answering.get(id);
    if (cached && Date.now() < cached.until) return cached.ok;
    const ok = readers.clientAnswers(id).catch(() => false);
    const asked = Date.now();
    answering.set(id, { until: asked + CLIENT_SILENCE_REUSE_MS, ok });
    void ok.then((answered) => {
      if (answered) {
        answering.set(id, { until: asked + CLIENT_ANSWER_REUSE_MS, ok });
      }
    });
    return ok;
  }

  /** The saved Client ID, or the page's when none is saved and that Client answers. */
  async function clientIdFor(
    tab: number | undefined,
    saved?: string,
  ): Promise<string | undefined> {
    if (saved) return saved;
    if (tab === undefined || !readers.detectClient) return undefined;
    const found = await readers.detectClient(tab).catch(() => undefined);
    return found && (await answers(found)) ? found : undefined;
  }

  /** The named files from the Client, or from the CDN when the Client does not answer. */
  async function files(
    runContext: unknown,
    saved: string | undefined,
    names: readonly string[],
    { storedChats = false }: { storedChats?: boolean } = {},
  ): Promise<ClientEvidence> {
    const tab = tabOf(runContext);
    const id = await clientIdFor(tab, saved);
    const fromClient = await clientFiles(id, names);
    if (fromClient.connection.ok) return fromClient;
    const cdn = await cdnFor(tab, names, storedChats);
    if (!cdn) return fromClient;
    const fromCdn = await loadEvidenceFrom(cdn, names).catch(() => undefined);
    if (fromCdn?.connection.ok) return { ...fromCdn, fromCdn: true };
    return fromClient.connection.ok
      ? fromClient
      : { ...fromClient, connection: withCdnUnread(fromClient.connection) };
  }

  return { cdnFor, clientIdFor, files };
}

const settingsStorage = new ChromeStorageAdapter<AppSettings>();

/** Settings → Apty Integration's content CDN fallback: on unless turned off. */
async function loadAptyCdnFallback(): Promise<boolean> {
  const settings = await settingsStorage
    .load(STORAGE_KEYS.SETTINGS)
    .catch(() => null);
  return settings?.aptyCdnFallback !== false;
}

export const DEFAULT_APTY_FILES_READERS: AptyFilesReaders = {
  cdnFallback: loadAptyCdnFallback,
  detectClient: detectClientExtensionId,
  clientAnswers: async (extensionId) =>
    (
      await sendExternalMessageDetailed(
        extensionId,
        { type: "apty-debug-agent:get-service-worker-status" },
        CLIENT_PING_MS,
      )
    ).ok,
  cdn: (tabId, names, { storedChats }) =>
    createCdnResourceSource({
      page: tabAptyPage(tabId),
      files: names,
      storedChats,
    }),
};

const forTab = createAptyFiles(DEFAULT_APTY_FILES_READERS);

/** The named content files for the conversation's tab, from the Client or the CDN. */
export const readAptyFilesForTab = forTab.files;
