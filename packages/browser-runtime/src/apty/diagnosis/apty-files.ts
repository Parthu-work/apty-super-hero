/**
 * Where every check reads Apty's content files for the conversation's tab:
 * the Apty Client's record, or Apty's public content CDN when the Client
 * does not report its calls (every Client today in Extension mode). The
 * Client is asked with the saved ID, or with the ID the page shows when that
 * Client answers at all.
 */

import { loadSettings } from "../../runtime/effective-settings.js";
import {
  type CdnResourceSource,
  createCdnResourceSource,
  detectClientExtensionId,
  tabAptyPage,
} from "../apty-cdn-source.js";
import { sendExternalMessageDetailed } from "../external-messaging.js";
import { aptyContentCalls } from "../network-capture-session.js";
import type { AptyObservedResource } from "../types.js";
import type { ClientPing, DaptyTrace } from "./dapty-evidence.js";
import {
  loadClientEvidence,
  loadEvidenceFrom,
  type ResourceSource,
} from "./loader.js";
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
  /** The Apty content calls the tab's page network capture saw (KB-RAG K15). */
  capture?: (tabId: number) => CapturedAptyCalls | undefined;
}

export interface CapturedAptyCalls {
  resources: AptyObservedResource[];
  bodies: ReadonlyMap<string, string>;
}

/** A capture's Apty calls as a source the loader reads like the Client's. */
export function captureSource(calls: CapturedAptyCalls): ResourceSource {
  return {
    listResources: async () => ({ ok: true, resources: calls.resources }),
    getResourceBody: async (requestId) => {
      const body = calls.bodies.get(requestId);
      return body === undefined
        ? { found: false, reason: "none" }
        : { found: true, body, base64Encoded: false };
    },
  };
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
    trace?: DaptyTrace,
  ): Promise<string | undefined> {
    const ping = (result: ClientPing) => {
      if (trace) trace.clientPing ??= result;
    };
    if (saved) {
      ping("saved-id");
      return saved;
    }
    if (tab === undefined || !readers.detectClient) {
      ping("no-tab");
      return undefined;
    }
    const found = await readers.detectClient(tab).catch(() => undefined);
    if (!found) {
      ping("not-on-page");
      return undefined;
    }
    const ok = await answers(found);
    ping(ok ? "answered" : "silent");
    return ok ? found : undefined;
  }

  /** The named files from the Client, or from the CDN when the Client does not answer. */
  async function files(
    runContext: unknown,
    saved: string | undefined,
    names: readonly string[],
    {
      storedChats = false,
      trace,
    }: { storedChats?: boolean; trace?: DaptyTrace } = {},
  ): Promise<ClientEvidence> {
    const started = Date.now();
    const tab = tabOf(runContext);
    const id = await clientIdFor(tab, saved, trace);
    const fromClient = await clientFiles(id, names);
    const done = (evidence: ClientEvidence) => {
      if (trace) trace.filesMs = Date.now() - started;
      return evidence;
    };
    if (fromClient.connection.ok) return done(fromClient);
    if (trace) trace.filesConnection = fromClient.connection.failure;
    const captured = tab === undefined ? undefined : readers.capture?.(tab);
    if (captured && captured.resources.length > 0) {
      const fromCapture = await loadEvidenceFrom(
        captureSource(captured),
        names,
      ).catch(() => undefined);
      if (fromCapture?.connection.ok) {
        return done({ ...fromCapture, fromCapture: true });
      }
    }
    const cdn = await cdnFor(tab, names, storedChats);
    if (!cdn) return done(fromClient);
    const fromCdn = await loadEvidenceFrom(cdn, names).catch(() => undefined);
    if (trace) {
      const probe = await cdn.probe().catch(() => undefined);
      if (probe) trace.cdnProbe = probe.ok ? "ok" : probe.reason;
    }
    if (fromCdn?.connection.ok) return done({ ...fromCdn, fromCdn: true });
    return done(
      fromClient.connection.ok
        ? fromClient
        : { ...fromClient, connection: withCdnUnread(fromClient.connection) },
    );
  }

  return { cdnFor, clientIdFor, files };
}

/** Settings → Apty Integration's content CDN fallback: on unless turned off. */
async function loadAptyCdnFallback(): Promise<boolean> {
  const settings = await loadSettings().catch(() => null);
  return settings?.aptyCdnFallback !== false;
}

export const DEFAULT_APTY_FILES_READERS: AptyFilesReaders = {
  capture: aptyContentCalls,
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
