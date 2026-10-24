/**
 * The application crawl shared by DOM Health's Audit Application and DOM
 * Config: discovery, the queue, the state graph, restoration and the hard
 * limits, with the per-state work left to a visitor. The design, the
 * safety rules and the defects it fixes are described in
 * `application-audit.ts`.
 */
import {
  isSafeNavigationCandidate,
  isSafeToDiscover,
} from "@apty/dom-snapshot";
import type {
  PageAuditRecord,
  PageDiscoverySource,
  RestorationEvidence,
} from "./application-scoring.js";
import { isUnsupportedPage } from "./dom-health.js";
import {
  captureApplicationState,
  toFrameSignatureEntries,
} from "./frame-audit.js";
import { urlTemplate } from "./frame-identity.js";
import { peekTabRequests } from "./network-capture-session.js";
import {
  type ClickCandidateResult,
  clickDiscoveredLink,
  clickSafeNavigationCandidate,
  collectPageLinks,
  collectSafeNavigationCandidates,
  type FrameTaggedLink,
  type FrameTaggedSafeNavigationCandidate,
  getNavigationModel,
  navigateTab,
  waitForDomStable,
} from "./page-navigation.js";
import type { RouteKey } from "./route-key.js";
import {
  type AuditStateFingerprint,
  compareStateFingerprints,
  computeStateFingerprint,
  type StateComparison,
  unknownStateFingerprint,
} from "./state-fingerprint.js";
import { StateGraph, type StateTransitionEdge } from "./state-graph.js";
import {
  chooseTraversalMode,
  corroboratingSignals,
  describeCorroboration,
  EMPTY_TRAVERSAL_EVIDENCE,
  frameSrcChanges,
  newRequestTemplates,
  type TransitionCorroboration,
  type TraversalEvidence,
  type TraversalMode,
  type TraversalModeChange,
} from "./traversal-strategy.js";

export interface ApplicationAuditLimits {
  /** Maximum number of states actually audited in one run. Defaults to 15. */
  maxPages?: number;
  /** Wall-clock ceiling for the whole run, regardless of state count. Defaults to 3 minutes. */
  maxTotalAuditMs?: number;
  /** Maximum number of states ever queued for discovery (bounds runaway link/candidate discovery). Defaults to 100. */
  maxQueueSize?: number;
  /** Maximum number of "skipped"/"not-discovered" inventory rows recorded, so one state full of disallowed targets can't flood the report. Defaults to 50. */
  maxSkipRows?: number;
}

export const DEFAULT_APPLICATION_MAX_PAGES = 15;

const DEFAULT_LIMITS: Required<ApplicationAuditLimits> = {
  maxPages: DEFAULT_APPLICATION_MAX_PAGES,
  maxTotalAuditMs: 180_000,
  maxQueueSize: 100,
  maxSkipRows: 50,
};

export type ApplicationAuditProgress =
  | { phase: "auditing"; url: string; pageIndex: number; pagesQueued: number }
  | { phase: "discovering-links"; url: string }
  | { phase: "restoring-state"; targetUrl: string };

/**
 * Explicit discovery scope — the caller must say how far this run is
 * allowed to go; there is no silent "deepest available" default:
 *
 * - "page": audit ONLY the seed page/state. No link discovery, no
 *   safe-navigation-candidate discovery, no navigation away from the
 *   current page at all — the narrowest possible scope, useful when the
 *   caller wants the application-audit result SHAPE (coverage/evidence
 *   fields) without any multi-state exploration.
 * - "application-safe": discover other same-origin pages via real
 *   `<a href>` links, and DETECT (but never click) menu/tab/tree-style
 *   navigation controls with no real href — those are reported
 *   `not-discovered`, never silently explored. This is the previous
 *   default behavior (formerly `allowClickDiscovery: false`).
 * - "application-deep": additionally CLICKS detected safe navigation
 *   candidates to explore same-URL, menu-driven application states
 *   (the Infor-LN-shaped case) — a real click on the live application,
 *   never enabled unless the caller explicitly asks for it (formerly
 *   `allowClickDiscovery: true`).
 */
export type ApplicationDiscoveryMode =
  | "page"
  | "application-safe"
  | "application-deep";

/** What makes two queued URLs the same page: their template (`urlTemplate`), so `/patients/111` and `/patients/222` are audited once and `#/orders` and `#/customers` are not merged (defect D-2). */
function urlIdentity(url: string): string {
  return urlTemplate(url).template;
}

interface UrlQueueItem {
  kind: "url";
  url: string;
  source: "seed" | "same-origin-link";
  /** Which graph state was live when this URL was discovered/queued. */
  sourceStateId: string;
  /** Where the link was found, so restoration can click it when loading the URL does not reproduce the page. */
  linkFrameId?: number;
  linkDomPath?: string;
}

interface ClickQueueItem {
  kind: "click";
  fromUrl: string;
  frameId: number;
  domPath: string;
  candidateText: string;
  /** The graph state this candidate was found on — the live tab MUST be showing this exact state before the click is valid; see `restoreToState`. */
  sourceStateId: string;
}

type QueueItem = UrlQueueItem | ClickQueueItem;

/** One lightweight, read-only capture used only to compute a state fingerprint — never the full 3-round audit. */
export async function captureFingerprint(
  tabId: number,
  ignoredRoots: readonly string[] = [],
): Promise<AuditStateFingerprint | null> {
  const outcome = await captureApplicationState(tabId, {
    sequenceIndex: 0,
    ignoredRoots,
  }).catch(() => null);
  if (!outcome || !outcome.available) return null;
  return computeStateFingerprint(
    toFrameSignatureEntries(outcome.result.frames),
  );
}

/** How long before a click the network capture is read, to tell a request the click caused from one the page was already making. */
const NETWORK_LOOKBACK_MS = 10_000;

/**
 * Capture the state the tab should now show. Right after a load a frame
 * can fail to answer once, which makes the comparison "uncertain", not
 * "different": then the DOM is let settle and the state captured once
 * more before anything is concluded from it.
 */
async function captureExpecting(
  tabId: number,
  expected: AuditStateFingerprint | undefined,
  capture: () => Promise<AuditStateFingerprint | null>,
): Promise<AuditStateFingerprint | null> {
  const first = await capture();
  if (
    expected &&
    (!first || compareStateFingerprints(expected, first).result === "uncertain")
  ) {
    await waitForDomStable(tabId);
    return (await capture()) ?? first;
  }
  return first;
}

/** What restoration needs from the traversal strategy: the current mode, and a place to report how a direct URL load went. */
interface RestorationStrategy {
  mode: () => TraversalMode;
  onDirectUrlLoad: (reproduced: boolean) => void;
  capture: () => Promise<AuditStateFingerprint | null>;
}

/**
 * Restore the live tab to `targetStateId` before acting on one of its
 * children. In URL-first mode a path of URL loads only is restored by
 * loading the target's URL once. When that does not reproduce the
 * target's RouteKey, or in click-first mode, or when the path contains a
 * click, the seed URL is reloaded and the recorded path replayed hop by
 * hop, clicking each control and, once direct loads are known not to
 * work, each link (`replayFromSeed`). Never pretends success: a hop that
 * does not reproduce the recorded state fails the restoration.
 */
async function restoreToState(
  tabId: number,
  seedUrl: string,
  graph: StateGraph,
  targetStateId: string,
  strategy: RestorationStrategy,
): Promise<RestorationEvidence> {
  if (graph.getCurrentStateId() === targetStateId) {
    return { targetStateId, success: true, stepCount: 0 };
  }
  const targetNode = graph.getNode(targetStateId);
  if (!targetNode) {
    return {
      targetStateId,
      success: false,
      stepCount: 0,
      reason: "Target state is not present in the discovery graph.",
    };
  }
  const path = graph.getRestorationPath(targetStateId);

  const isPureUrlPath = path.every((e) => e.trigger.kind !== "click");
  if (isPureUrlPath && strategy.mode() === "url-first") {
    await navigateTab(tabId, targetNode.url);
    await waitForDomStable(tabId);
    const observed = await captureExpecting(
      tabId,
      targetNode.fingerprint,
      strategy.capture,
    );
    const reproduced =
      observed?.fingerprint === targetNode.fingerprint.fingerprint;
    strategy.onDirectUrlLoad(reproduced);
    if (reproduced) {
      graph.setCurrentStateId(targetStateId);
      return {
        targetStateId,
        success: true,
        stepCount: path.length,
        method: "direct-url",
      };
    }
    return replayFromSeed(
      tabId,
      seedUrl,
      graph,
      targetStateId,
      path,
      strategy.capture,
      true,
    );
  }
  return replayFromSeed(
    tabId,
    seedUrl,
    graph,
    targetStateId,
    path,
    strategy.capture,
    false,
    strategy.mode() === "click-first",
  );
}

async function replayFromSeed(
  tabId: number,
  seedUrl: string,
  graph: StateGraph,
  targetStateId: string,
  path: StateTransitionEdge[],
  capture: () => Promise<AuditStateFingerprint | null>,
  fellBackFromDirectUrl: boolean,
  clickLinks = fellBackFromDirectUrl,
): Promise<RestorationEvidence> {
  const outcome = (
    success: boolean,
    failedAtStep?: number,
    reason?: string,
  ): RestorationEvidence => ({
    targetStateId,
    success,
    stepCount: path.length,
    ...(failedAtStep === undefined ? {} : { failedAtStep, reason }),
    method: "replay",
    ...(fellBackFromDirectUrl
      ? {
          fellBackFromDirectUrl,
          ...(success
            ? {
                reason:
                  "Loading this state's URL directly did not reproduce it; it was reached by replaying the recorded path from the seed instead.",
              }
            : {}),
        }
      : {}),
  });

  await navigateTab(tabId, seedUrl);
  await waitForDomStable(tabId);
  const seedStateId = graph.getSeedStateId();
  const seedNode = seedStateId ? graph.getNode(seedStateId) : undefined;
  if (seedNode && seedStateId !== targetStateId) {
    const atSeed = await captureExpecting(tabId, seedNode.fingerprint, capture);
    if (atSeed?.fingerprint !== seedNode.fingerprint.fingerprint) {
      return outcome(
        false,
        0,
        "Reloading the seed URL did not reproduce the seed state, so the recorded path cannot be replayed from it.",
      );
    }
  }

  for (let i = 0; i < path.length; i++) {
    const edge: StateTransitionEdge = path[i]!;
    const { trigger } = edge;
    let click: ClickCandidateResult | null = null;
    if (trigger.kind === "click") {
      click = await clickSafeNavigationCandidate(
        tabId,
        trigger.frameId!,
        trigger.domPath!,
      );
    } else if (
      trigger.kind === "url-navigation" &&
      clickLinks &&
      trigger.domPath !== undefined &&
      trigger.frameId !== undefined
    ) {
      click = await clickDiscoveredLink(
        tabId,
        trigger.frameId,
        trigger.domPath,
      );
    } else if (trigger.kind === "url-navigation" && trigger.url) {
      await navigateTab(tabId, trigger.url);
    }
    if (click && !click.clicked) {
      return outcome(
        false,
        i,
        `Replaying step ${i + 1}/${path.length} ("${trigger.candidateText ?? trigger.domPath}") failed: ${click.reason ?? "click did not succeed"}.`,
      );
    }
    await waitForDomStable(tabId);
    const observed = await captureExpecting(
      tabId,
      graph.getNode(edge.targetStateId)?.fingerprint,
      capture,
    );
    if (observed?.fingerprint !== edge.afterFingerprint) {
      return outcome(
        false,
        i,
        `Replaying step ${i + 1}/${path.length} produced a different state than originally recorded — the application may not be deterministically restorable via this path.`,
      );
    }
  }

  graph.setCurrentStateId(targetStateId);
  return outcome(true);
}

/** One inventory row; `visit` is what the visitor returned for a completed state. */
export type CrawlRow<V> = Omit<
  PageAuditRecord,
  "result" | "frameAccessibility"
> & { visit?: V };

export interface CrawlRevisit {
  comparison: StateComparison | "failed";
  method: "navigation" | "replay";
  reason?: string;
}

export interface CrawlVisitContext {
  stateId: string;
  source: PageDiscoverySource;
  /** The state's fingerprint, absent when it could not be captured. */
  fingerprint: string | undefined;
  routeKey: RouteKey | undefined;
  /** Load this state again (D13). Discovery from it afterwards only follows links unless the comparison is "same". */
  revisit: () => Promise<CrawlRevisit>;
}

type CrawlVisit<V> =
  | { available: true; url: string; visit: V }
  | { available: false; error: string }
  /** A state the visitor already holds: recorded `skipped-duplicate` with this reason, not counted against `maxPages`, not explored. */
  | { available: false; duplicate: string };

export interface CrawlOptions<V> extends ApplicationAuditLimits {
  onProgress?: (progress: ApplicationAuditProgress) => void;
  /** Defaults to "application-safe" — never silently "application-deep". */
  discoveryMode?: ApplicationDiscoveryMode;
  ignoredRoots?: readonly string[];
  /** Checked between states; the crawl stops and returns what it has. */
  signal?: AbortSignal;
  /** The per-state work, called once the live tab shows a new state and the DOM has settled. */
  visit: (context: CrawlVisitContext) => Promise<CrawlVisit<V>>;
}

interface CrawlResult<V> {
  seedUrl: string;
  rows: CrawlRow<V>[];
  graph: StateGraph;
  restorations: RestorationEvidence[];
  traversal: {
    mode: TraversalMode;
    reason: string;
    evidence: TraversalEvidence;
    history: TraversalModeChange[];
  };
  /** Queued work left when the crawl stopped. */
  unexplored: { url: string; kind: "url" | "click" }[];
  limitsReached: { maxPages: boolean; maxTotalAuditMs: boolean };
  aborted: boolean;
}

export type CrawlOutcome<V> =
  | { available: true; result: CrawlResult<V> }
  | { available: false; error: string };

function notVisited(
  visited: Exclude<CrawlVisit<unknown>, { available: true }>,
): Pick<PageAuditRecord, "status" | "failureReason"> {
  return "duplicate" in visited
    ? { status: "skipped-duplicate", failureReason: visited.duplicate }
    : { status: "failed", failureReason: visited.error };
}

/**
 * Crawl the application from the tab's current state. Literal `<a href>`
 * discovery never executes anything; controls without a link are only
 * clicked in "application-deep" mode.
 */
export async function crawlApplication<V>(
  tabId: number,
  options: CrawlOptions<V>,
): Promise<CrawlOutcome<V>> {
  const limits: Required<ApplicationAuditLimits> = {
    ...DEFAULT_LIMITS,
    ...options,
  };
  const discoveryMode: ApplicationDiscoveryMode =
    options.discoveryMode ?? "application-safe";
  const allowClickDiscovery = discoveryMode === "application-deep";
  const startedAt = Date.now();

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return {
      available: false,
      error: "The target tab could not be found — it may have been closed.",
    };
  }

  const seedUrl = tab.url;
  if (isUnsupportedPage(seedUrl)) {
    return {
      available: false,
      error:
        "This page does not allow DOM inspection (browser and extension internal pages are not accessible to content scripts).",
    };
  }

  const visitedUrls = new Set<string>();
  const queuedUrls = new Set<string>();
  const skippedUrls = new Set<string>();
  const skippedCandidates = new Set<string>();
  const restorations: RestorationEvidence[] = [];

  const ignoredRoots = options.ignoredRoots ?? [];
  const capture = () => captureFingerprint(tabId, ignoredRoots);
  const graph = new StateGraph();
  await waitForDomStable(tabId);
  const seedFingerprint = (await capture()) ?? unknownStateFingerprint();
  const seedStateId = graph.addSeedState(seedFingerprint, seedUrl!, null);

  const traversalEvidence: TraversalEvidence = { ...EMPTY_TRAVERSAL_EVIDENCE };
  const traversalHistory: TraversalModeChange[] = [];
  let traversal: { mode: TraversalMode; reason: string } = {
    mode: "url-first",
    reason: "Only the seed state was audited, so no traversal was needed.",
  };
  /** Re-run the mode decision on the evidence so far; a change is kept in the history with its reason. */
  function decideTraversal(): void {
    const decision = chooseTraversalMode(traversalEvidence);
    const reason =
      decision.mode === "click-first" && !allowClickDiscovery
        ? `${decision.reason} Click-based discovery is off (discoveryMode "${discoveryMode}"), so navigation controls are reported, not explored.`
        : decision.reason;
    if (traversalHistory.at(-1)?.mode !== decision.mode) {
      traversalHistory.push({
        mode: decision.mode,
        reason,
        afterStates: graph.getAllNodes().length,
      });
    }
    traversal = { mode: decision.mode, reason };
  }
  function noteTransition(edge: StateTransitionEdge): void {
    traversalEvidence.edges++;
    if (edge.sameUrl) traversalEvidence.sameUrlEdges++;
    decideTraversal();
  }
  const restorationStrategy: RestorationStrategy = {
    capture,
    mode: () => traversal.mode,
    onDirectUrlLoad: (reproduced) => {
      traversalEvidence.urlRestorations++;
      if (!reproduced) traversalEvidence.urlRestorationFailures++;
      decideTraversal();
    },
  };
  /** In click-first mode, controls are explored before links. */
  function takeNext(): QueueItem {
    if (traversal.mode === "click-first") {
      const index = queue.findIndex((item) => item.kind === "click");
      if (index > 0) return queue.splice(index, 1)[0]!;
    }
    return queue.shift()!;
  }

  function visitContext(
    stateId: string,
    source: PageDiscoverySource,
  ): CrawlVisitContext {
    const captured = graph.getNode(stateId)?.fingerprint;
    const known =
      captured && captured.fingerprint !== unknownStateFingerprint().fingerprint
        ? captured
        : undefined;
    return {
      stateId,
      source,
      fingerprint: known?.fingerprint,
      routeKey: known?.routeKey,
      revisit: () => revisitState(stateId),
    };
  }

  /** A fresh visit to `stateId`: its URL loaded again, or, for a state a click reached, the recorded path replayed from the seed. Anything but "same" leaves the live state unknown. */
  async function revisitState(stateId: string): Promise<CrawlRevisit> {
    const node = graph.getNode(stateId)!;
    const path = graph.getRestorationPath(stateId);
    if (path.some((edge) => edge.trigger.kind === "click")) {
      const restoration = await replayFromSeed(
        tabId,
        seedUrl!,
        graph,
        stateId,
        path,
        capture,
        false,
        traversal.mode === "click-first",
      );
      if (restoration.success) return { comparison: "same", method: "replay" };
      graph.forgetCurrentState();
      return {
        comparison: "failed",
        method: "replay",
        reason:
          restoration.reason ?? "The recorded path could not be replayed.",
      };
    }
    try {
      await navigateTab(tabId, node.url);
    } catch (error) {
      graph.forgetCurrentState();
      return {
        comparison: "failed",
        method: "navigation",
        reason: error instanceof Error ? error.message : "Navigation failed",
      };
    }
    await waitForDomStable(tabId);
    const observed = await captureExpecting(tabId, node.fingerprint, capture);
    if (!observed) {
      graph.forgetCurrentState();
      return {
        comparison: "failed",
        method: "navigation",
        reason: "The state reached could not be identified.",
      };
    }
    const comparison = compareStateFingerprints(node.fingerprint, observed);
    if (comparison.result === "same") {
      graph.setCurrentStateId(stateId);
      return { comparison: "same", method: "navigation" };
    }
    graph.forgetCurrentState();
    return {
      comparison: comparison.result,
      method: "navigation",
      reason: comparison.reasons.join("; "),
    };
  }

  const queue: QueueItem[] = [
    { kind: "url", url: seedUrl!, source: "seed", sourceStateId: seedStateId },
  ];
  queuedUrls.add(urlIdentity(seedUrl!));
  const pages: CrawlRow<V>[] = [];
  let isFirstItem = true;
  let auditedCount = 0;

  /** Discover more work from the state just audited — same for both URL-based and click-based states. `currentStateId` is the graph node this state resolved to, so newly-found candidates carry a correct, restorable `sourceStateId`. */
  async function discoverFromCurrentState(
    currentUrl: string,
    currentStateId: string,
  ): Promise<void> {
    options.onProgress?.({ phase: "discovering-links", url: currentUrl });

    // Best-effort, non-fatal: if discovery fails for any reason, the audit
    // still returns everything gathered so far rather than aborting.
    const navigationModel = await getNavigationModel(tabId).catch(() => null);
    if (navigationModel) {
      const lastPage = pages[pages.length - 1];
      if (lastPage) lastPage.navigationModel = navigationModel;
    }

    const links: FrameTaggedLink[] = await collectPageLinks(tabId).catch(
      () => [],
    );
    for (const link of links) {
      if (queue.length >= limits.maxQueueSize) break;
      const normalizedLink = urlIdentity(link.absoluteUrl);
      if (visitedUrls.has(normalizedLink) || queuedUrls.has(normalizedLink)) {
        continue;
      }
      if (!isSafeToDiscover(link)) {
        if (
          !skippedUrls.has(normalizedLink) &&
          skippedUrls.size < limits.maxSkipRows
        ) {
          skippedUrls.add(normalizedLink);
          pages.push({
            url: link.absoluteUrl,
            title: null,
            discoverySource: link.sameOrigin
              ? "same-origin-link"
              : "cross-origin-link",
            status: link.sameOrigin ? "skipped-unsafe" : "skipped-cross-origin",
          });
        }
        continue;
      }
      queue.push({
        kind: "url",
        url: link.absoluteUrl,
        source: "same-origin-link",
        sourceStateId: currentStateId,
        linkFrameId: link.frameId,
        linkDomPath: link.domPath,
      });
      queuedUrls.add(normalizedLink);
    }

    // Non-anchor navigation candidates — ALWAYS detected (read-only), but
    // only ever queued for an actual click when explicitly opted in.
    // After a revisit that did not reproduce this state, the live controls
    // belong to some other screen: they are not attributed to this one.
    const candidates: FrameTaggedSafeNavigationCandidate[] =
      graph.getCurrentStateId() === currentStateId
        ? await collectSafeNavigationCandidates(tabId).catch(() => [])
        : [];
    for (const candidate of candidates) {
      if (queue.length >= limits.maxQueueSize) break;
      const key = `${currentStateId}:${candidate.frameId}:${candidate.domPath}`;
      if (skippedCandidates.has(key)) continue;

      if (!isSafeNavigationCandidate(candidate)) {
        if (skippedCandidates.size < limits.maxSkipRows) {
          skippedCandidates.add(key);
          pages.push({
            url: `${currentUrl}#control:${candidate.domPath}`,
            title: candidate.text,
            discoverySource: "safe-navigation-control",
            status: "skipped-unsafe",
          });
        }
        continue;
      }

      if (!allowClickDiscovery) {
        if (skippedCandidates.size < limits.maxSkipRows) {
          skippedCandidates.add(key);
          pages.push({
            url: `${currentUrl}#control:${candidate.domPath}`,
            title: candidate.text,
            discoverySource: "safe-navigation-control",
            status: "not-discovered",
            failureReason:
              "Click-based discovery is off by default (allowClickDiscovery). This control was detected but never clicked.",
          });
        }
        continue;
      }

      skippedCandidates.add(key);
      queue.push({
        kind: "click",
        fromUrl: currentUrl,
        frameId: candidate.frameId,
        domPath: candidate.domPath,
        candidateText: candidate.text,
        sourceStateId: currentStateId,
      });
    }

    if (currentStateId === seedStateId) {
      const seedTemplate = urlIdentity(currentUrl);
      traversalEvidence.seedLinkTemplates = new Set(
        links
          .filter((link) => isSafeToDiscover(link))
          .map((link) => urlIdentity(link.absoluteUrl))
          .filter((template) => template !== seedTemplate),
      ).size;
      // A nav anchor is also a discovered link; only controls without one
      // speak for click navigation.
      traversalEvidence.seedNavigationCandidates = candidates.filter(
        (candidate) =>
          isSafeNavigationCandidate(candidate) && candidate.tagName !== "a",
      ).length;
      decideTraversal();
    }
  }

  const aborted = () => options.signal?.aborted === true;
  while (
    queue.length > 0 &&
    auditedCount < limits.maxPages &&
    Date.now() - startedAt < limits.maxTotalAuditMs &&
    !aborted()
  ) {
    const next = takeNext();

    if (next.kind === "url") {
      const normalized = urlIdentity(next.url);
      queuedUrls.delete(normalized);
      if (visitedUrls.has(normalized)) {
        pages.push({
          url: next.url,
          title: null,
          discoverySource: next.source,
          status: "skipped-duplicate",
        });
        continue;
      }
      visitedUrls.add(normalized);

      options.onProgress?.({
        phase: "auditing",
        url: next.url,
        pageIndex: pages.length,
        pagesQueued: queue.length,
      });

      if (!isFirstItem) {
        try {
          await navigateTab(tabId, next.url);
        } catch (error) {
          pages.push({
            url: next.url,
            title: null,
            discoverySource: next.source,
            status: "failed",
            failureReason:
              error instanceof Error ? error.message : "Navigation failed",
          });
          continue;
        }
      }
      isFirstItem = false;

      await waitForDomStable(tabId);

      // Identify the state before auditing it: a URL that lands on a state
      // already recorded (a redirect, a session-scoped deep link) is not
      // audited again under a new name.
      let stateId = graph.getCurrentStateId()!;
      if (next.source !== "seed") {
        const fingerprint = await capture();
        if (!fingerprint) {
          pages.push({
            url: next.url,
            title: null,
            discoverySource: next.source,
            status: "failed",
            failureReason:
              "The state reached by loading this URL could not be identified.",
          });
          continue;
        }
        const landedUrl =
          (await chrome.tabs.get(tabId).catch(() => null))?.url ?? next.url;
        const transition = graph.recordTransition({
          sourceStateId: next.sourceStateId,
          trigger: {
            kind: "url-navigation",
            url: next.url,
            frameId: next.linkFrameId,
            domPath: next.linkDomPath,
          },
          beforeFingerprint:
            graph.getNode(next.sourceStateId)?.fingerprint ?? seedFingerprint,
          afterFingerprint: fingerprint,
          url: landedUrl,
          title: null,
          historyEventDelta: 0,
        });
        noteTransition(transition.edge);
        if (!transition.isNew) {
          pages.push({
            url: next.url,
            title: null,
            discoverySource: next.source,
            status: "skipped-duplicate",
            failureReason: `Loading this URL showed a state already recorded (${transition.stateId}).`,
          });
          continue;
        }
        stateId = transition.stateId;
      }

      const visited = await options.visit(visitContext(stateId, next.source));
      if (!visited.available) {
        pages.push({
          url: next.url,
          title: null,
          discoverySource: next.source,
          ...notVisited(visited),
        });
        continue;
      }

      auditedCount++;

      pages.push({
        url: visited.url,
        title: null,
        discoverySource: next.source,
        status: "completed",
        visit: visited.visit,
        transitionReason: "url",
      });

      if (auditedCount >= limits.maxPages) break;
      if (Date.now() - startedAt >= limits.maxTotalAuditMs) break;
      if (aborted()) break;

      // "page" mode never explores beyond the seed state at all — no link
      // discovery, no candidate discovery, no navigation away from it.
      if (discoveryMode !== "page") {
        await discoverFromCurrentState(visited.url, stateId);
      }
      continue;
    }

    // next.kind === "click" — only ever reached when allowClickDiscovery is true.
    if (graph.getCurrentStateId() !== next.sourceStateId) {
      options.onProgress?.({
        phase: "restoring-state",
        targetUrl: graph.getNode(next.sourceStateId)?.url ?? next.fromUrl,
      });
      const restoration = await restoreToState(
        tabId,
        seedUrl!,
        graph,
        next.sourceStateId,
        restorationStrategy,
      );
      restorations.push(restoration);
      if (!restoration.success) {
        pages.push({
          url: `${next.fromUrl}#control:${next.domPath}`,
          title: next.candidateText,
          discoverySource: "safe-navigation-control",
          status: "not-discovered",
          failureReason: `Could not restore to the state this control was found on before exploring it: ${restoration.reason ?? "restoration failed"}`,
        });
        continue;
      }
    }

    const beforeNavModel = await getNavigationModel(tabId).catch(() => null);
    const beforeFingerprint = await captureExpecting(
      tabId,
      graph.getNode(next.sourceStateId)?.fingerprint,
      capture,
    );
    const clickedAt = Date.now();
    const requestsBefore = peekTabRequests(
      tabId,
      clickedAt - NETWORK_LOOKBACK_MS,
    );
    const clickResult = await clickSafeNavigationCandidate(
      tabId,
      next.frameId,
      next.domPath,
    );
    if (!clickResult.clicked) {
      pages.push({
        url: `${next.fromUrl}#control:${next.domPath}`,
        title: next.candidateText,
        discoverySource: "safe-navigation-control",
        status: "not-discovered",
        failureReason: clickResult.reason ?? "Click did not succeed.",
      });
      continue;
    }

    await waitForDomStable(tabId);
    const afterFingerprint = await capture();
    const afterNavModel = await getNavigationModel(tabId).catch(() => null);
    const historyEventDelta =
      beforeNavModel && afterNavModel
        ? Math.max(
            0,
            afterNavModel.historyApiCallCount -
              beforeNavModel.historyApiCallCount,
          )
        : 0;

    if (!beforeFingerprint || !afterFingerprint) {
      pages.push({
        url: `${next.fromUrl}#control:${next.domPath}`,
        title: next.candidateText,
        discoverySource: "safe-navigation-control",
        status: "not-discovered",
        failureReason:
          "Could not capture a state fingerprint to verify a transition occurred.",
      });
      continue;
    }

    const comparison = compareStateFingerprints(
      beforeFingerprint,
      afterFingerprint,
    );
    const requestsAfter = peekTabRequests(tabId, clickedAt);
    const corroboration: TransitionCorroboration = {
      historyEvents: historyEventDelta,
      frameSrcChanges: frameSrcChanges(
        beforeFingerprint.frames,
        afterFingerprint.frames,
      ),
      newRequestTemplates:
        requestsBefore && requestsAfter
          ? newRequestTemplates(
              requestsBefore.filter((r) => r.timestamp < clickedAt),
              requestsAfter,
            )
          : null,
    };
    const corroborated = corroboratingSignals(corroboration).length > 0;
    // History, frame URLs and network activity break a tie when the DOM
    // cannot say (a frame unreadable on one side); they never make a new
    // state out of a screen whose identity did not change, because that
    // state could never be told apart from its source again.
    if (
      comparison.result === "same" ||
      (comparison.result === "uncertain" && !corroborated)
    ) {
      pages.push({
        url: `${next.fromUrl}#control:${next.domPath}`,
        title: next.candidateText,
        discoverySource: "safe-navigation-control",
        // A screen verifiably unchanged was explored; an uncertain one was not.
        status:
          comparison.result === "same"
            ? "explored-no-new-state"
            : "not-discovered",
        failureReason:
          comparison.result === "uncertain"
            ? "State identity could not be confidently determined after clicking this control, and nothing else (history, frame URLs, network) corroborated a navigation."
            : corroborated
              ? `Clicking this control caused ${describeCorroboration(corroboration)}, but the screen's identity did not change: kept as evidence, not as a new state.`
              : "Clicking this control did not produce a new application state.",
      });
      continue;
    }

    const transition = graph.recordTransition({
      sourceStateId: next.sourceStateId,
      trigger: {
        kind: "click",
        frameId: next.frameId,
        domPath: next.domPath,
        candidateText: next.candidateText,
      },
      beforeFingerprint,
      afterFingerprint,
      url: next.fromUrl,
      title: next.candidateText,
      historyEventDelta,
      corroboration,
    });
    noteTransition(transition.edge);

    if (!transition.isNew) {
      pages.push({
        url: `${next.fromUrl}#control:${next.domPath}`,
        title: next.candidateText,
        discoverySource: "safe-navigation-control",
        status: "skipped-duplicate",
      });
      continue;
    }

    options.onProgress?.({
      phase: "auditing",
      url: `${next.fromUrl}#control:${next.domPath}`,
      pageIndex: pages.length,
      pagesQueued: queue.length,
    });

    const visited = await options.visit(
      visitContext(transition.stateId, "safe-navigation-control"),
    );
    if (!visited.available) {
      pages.push({
        url: `${next.fromUrl}#control:${next.domPath}`,
        title: next.candidateText,
        discoverySource: "safe-navigation-control",
        ...notVisited(visited),
      });
      continue;
    }

    auditedCount++;
    const reasonSuffix =
      comparison.result === "different"
        ? `${comparison.reasons.join("; ")} [route confidence: ${comparison.confidence}; corroborated by: ${describeCorroboration(corroboration)}]`
        : `the DOM signature was ambiguous (${comparison.reasons.join("; ")}), and ${describeCorroboration(corroboration)} corroborated a navigation`;
    // No new top-level URL exists for a same-URL state transition — the
    // audited page's own URL is reused, and the fingerprint (recorded in
    // transitionReason) is what actually distinguishes this state.
    pages.push({
      url: visited.url,
      title: null,
      discoverySource: "safe-navigation-control",
      status: "completed",
      visit: visited.visit,
      transitionReason: `structural signal changed after clicking "${next.candidateText}": ${reasonSuffix}`,
    });

    if (auditedCount >= limits.maxPages) break;
    if (Date.now() - startedAt >= limits.maxTotalAuditMs) break;
    if (aborted()) break;

    await discoverFromCurrentState(visited.url, transition.stateId);
  }

  return {
    available: true,
    result: {
      seedUrl: seedUrl!,
      rows: pages,
      graph,
      restorations,
      traversal: {
        ...traversal,
        evidence: { ...traversalEvidence },
        history: traversalHistory,
      },
      unexplored: queue.map((item) =>
        item.kind === "url"
          ? { url: item.url, kind: "url" }
          : { url: item.fromUrl, kind: "click" },
      ),
      limitsReached: {
        maxPages: auditedCount >= limits.maxPages,
        maxTotalAuditMs: Date.now() - startedAt >= limits.maxTotalAuditMs,
      },
      aborted: aborted(),
    },
  };
}
