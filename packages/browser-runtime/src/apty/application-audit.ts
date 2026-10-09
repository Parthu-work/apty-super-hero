/**
 * Application-wide DOM Health audit orchestrator (spec sections 2-6, 23-25).
 *
 * Forensic-audit fixes applied here:
 *
 * - RC-4 (discovery was anchor-only): every audited state's frames are also
 *   scanned read-only for safe-looking non-anchor navigation controls
 *   (menu items, tabs, tree nodes — see `@apty/dom-snapshot`'s
 *   `collectSafeNavigationCandidates`). By default these are only
 *   REPORTED (`status: "not-discovered"`), never clicked — see
 *   `allowClickDiscovery` below for the explicit, off-by-default opt-in
 *   that lets the audit actually click one to see whether it produces a
 *   new state.
 * - RC-5 (every transition assumed to be a URL navigation): a state is no
 *   longer identified by URL alone. Every discovered/audited state also
 *   gets a structural fingerprint (`state-fingerprint.ts`, built from
 *   `@apty/dom-snapshot`'s `computeFrameStateSignature`), so a
 *   same-URL, menu-driven transition (Infor LN's typical shape) can be
 *   recognized as a real state change even though `navigateTab`/
 *   `tabs.onUpdated("complete")` never fired for it.
 * - RC-1/RC-2 (frame-targeting race / legacy frame blindness): discovery
 *   (`collectPageLinks`, `collectSafeNavigationCandidates`,
 *   `getNavigationModel`) now queries every real frame in the tab by
 *   explicit `frameId` (see `page-navigation.ts`), not just the top one —
 *   a menu frame separate from the content frame is exactly the shape a
 *   classic enterprise frameset uses, and is no longer invisible to
 *   discovery.
 * - RC-6 (no backtracking — sibling branches were lost or corrupted): the
 *   previous design queued every same-URL click candidate found on a
 *   state as soon as that state was audited, then drained the queue
 *   strictly FIFO. Because a click actually changes the LIVE browser tab
 *   (there is no other way to reach a same-URL, menu-driven state), the
 *   second and later queued clicks from a state were only ever valid
 *   while the tab was still showing THAT state's DOM — but by the time
 *   they were dequeued, the crawler had already navigated deeper (and
 *   possibly explored several more levels). The stored `domPath`/`frameId`
 *   either matched nothing in the new, unrelated DOM, or worse, silently
 *   matched a different element that happened to share the same path.
 *   Every state is now tracked in a real discovery tree (`state-graph.ts`),
 *   and before acting on ANY click-based candidate whose source state
 *   isn't the one currently live in the tab, `restoreToState` replays the
 *   exact recorded path of clicks/navigations from the seed state back to
 *   it, verifying the fingerprint at every hop — a branch whose
 *   restoration doesn't reproduce the originally-recorded state is marked
 *   failed and skipped, never silently treated as restored.
 *
 * Hard limits (`maxPages`/`maxTotalAuditMs`/`maxQueueSize`) bound the whole
 * run; every state attempted — audited, failed, skipped, or detected-but-
 * not-explored — is recorded in the returned inventory, so coverage is
 * always explicit and always labeled "observed", never "total" (spec
 * section 4/9).
 *
 * Safety, unchanged from the original design and never weakened: literal
 * `<a href>` discovery never executes anything. The NEW non-anchor
 * discovery path is read-only by construction too — finding a candidate
 * never clicks it. Only `allowClickDiscovery: true` (never the default)
 * allows an actual click, and only ever on a candidate matching a narrow
 * container allowlist (nav/menu/tablist/tree), re-verified as non-
 * destructive and outside any `<form>` by the content script immediately
 * before clicking (see `health-links.ts`'s `collectSafeNavigationCandidates`
 * and the content script's `click-safe-navigation-candidate` handler) —
 * defense in depth, never a single check trusted alone.
 */
import {
  type ElementPathSample,
  isSafeNavigationCandidate,
  isSafeToDiscover,
} from "@apty/dom-snapshot";
import {
  type ApplicationAuditResult,
  buildApplicationAuditResult,
  type CrossStateSelectorEvidence,
  type PageAuditRecord,
  type RestorationEvidence,
  type StateGraphSummary,
} from "./application-scoring.js";
import { collectDomHealthAudit, isUnsupportedPage } from "./dom-health.js";
import { redactDomHealthOutput } from "./dom-health-redaction.js";
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
  type ElementPathReplaySample,
  type FrameTaggedLink,
  type FrameTaggedSafeNavigationCandidate,
  getNavigationModel,
  navigateTab,
  replayElementPathSamplesInFrame,
  waitForDomStable,
} from "./page-navigation.js";
import { summarizeRouteKey } from "./route-key.js";
import {
  type AuditStateFingerprint,
  compareStateFingerprints,
  computeStateFingerprint,
  unknownStateFingerprint,
} from "./state-fingerprint.js";
import {
  isSameUrl,
  StateGraph,
  type StateTransitionEdge,
} from "./state-graph.js";
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

/** How many host-chain breaks are kept, with their hop and host selector, as examples in the report. */
const MAX_HOST_CHAIN_BREAK_SAMPLES = 5;

const DEFAULT_LIMITS: Required<ApplicationAuditLimits> = {
  maxPages: 15,
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

export interface RunApplicationAuditOptions extends ApplicationAuditLimits {
  onProgress?: (progress: ApplicationAuditProgress) => void;
  /** Defaults to "application-safe" — never silently "application-deep". See `ApplicationDiscoveryMode`. */
  discoveryMode?: ApplicationDiscoveryMode;
  /** Settings entries excluded on top of the default ignored roots. */
  ignoredRoots?: readonly string[];
}

export type ApplicationAuditOutcome =
  | ({ available: true } & ApplicationAuditResult)
  | { available: false; error: string };

let auditSequence = 0;
function generateAuditId(): string {
  auditSequence += 1;
  return `app-dom-health-${Date.now()}-${auditSequence}`;
}

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
async function captureFingerprint(
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
    const observed = await strategy.capture();
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
    const atSeed = await capture();
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
    const observed = await capture();
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

function buildStateGraphSummary(graph: StateGraph): StateGraphSummary {
  const seedStateId = graph.getSeedStateId();
  const seedNode = seedStateId ? graph.getNode(seedStateId) : undefined;
  const routeConfidence = { high: 0, medium: 0, low: 0 };
  for (const node of graph.getAllNodes()) {
    routeConfidence[node.fingerprint.routeKey.confidence]++;
  }
  return {
    seedStateId,
    routeConfidence,
    nodes: graph.getAllNodes().map((node) => ({
      stateId: node.stateId,
      url: node.url,
      title: node.title,
      sameUrlAsSeed: seedNode ? isSameUrl(node.url, seedNode.url) : false,
      discoveredAt: node.discoveredAt,
      route: summarizeRouteKey(node.fingerprint.routeKey),
    })),
    edges: graph.getAllEdges().map((edge) => ({
      id: edge.id,
      sourceStateId: edge.sourceStateId,
      targetStateId: edge.targetStateId,
      triggerKind: edge.trigger.kind,
      triggerLabel:
        edge.trigger.kind === "click"
          ? (edge.trigger.candidateText ?? edge.trigger.domPath ?? "click")
          : (edge.trigger.url ?? "seed"),
      sameUrl: edge.sameUrl,
      historyEventDelta: edge.historyEventDelta,
      confidence: edge.confidence,
      ...(edge.corroboration
        ? {
            corroboratedBy: corroboratingSignals(edge.corroboration),
            networkObserved: edge.corroboration.newRequestTemplates !== null,
          }
        : {}),
    })),
  };
}

/**
 * Run a full application-wide DOM Health audit starting from the given
 * tab's current page/state. Safe by construction: literal `<a href>`
 * discovery never executes anything, and non-anchor discovery is
 * click-free unless `allowClickDiscovery` is explicitly set; hard limits
 * bound total states, queue size, and wall-clock time. Page titles are
 * never recorded in the result (they can name the practice or a patient,
 * see `REDACTED_TITLE`), and the result leaves through
 * `redactDomHealthOutput`.
 */
export async function runApplicationDomHealthAudit(
  tabId: number,
  options: RunApplicationAuditOptions = {},
): Promise<ApplicationAuditOutcome> {
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

  // Cross-application-state selector validation (spec section 7): a
  // bounded sample of real Apty paths captured at the SEED state, later
  // replayed (via `replayElementPathSamplesInFrame` — never regenerated)
  // against every OTHER state this run actually audits. Seed-vs-every-
  // other-state, not full all-pairs replay — a tractable, honestly-scoped
  // design (see `docs/development/dom-health-architecture.md`).
  let seedElementPathSamples: ElementPathSample[] = [];
  const crossStateEvidence: CrossStateSelectorEvidence = {
    attempted: 0,
    directStable: 0,
    recoveredStable: 0,
    positionalStable: 0,
    wrongTarget: 0,
    notResolved: 0,
    hostChainBroken: 0,
    hostChainBreaks: [],
    legacySamples: 0,
    statesTested: 0,
  };

  async function replaySeedPathsAgainstCurrentState(): Promise<void> {
    if (seedElementPathSamples.length === 0) return;
    const byFrame = new Map<number, ElementPathReplaySample[]>();
    for (const sample of seedElementPathSamples) {
      const frameId = sample.frameId ?? 0;
      const list = byFrame.get(frameId) ?? [];
      list.push({ fingerprint: sample.fingerprint, ref: sample.ref });
      byFrame.set(frameId, list);
    }
    let attemptedAny = false;
    for (const [frameId, samples] of byFrame) {
      const results = await replayElementPathSamplesInFrame(
        tabId,
        frameId,
        samples,
      ).catch(() => []);
      for (const r of results) {
        attemptedAny = true;
        crossStateEvidence.attempted++;
        if (r.legacy) crossStateEvidence.legacySamples++;
        switch (r.verdict) {
          case "DIRECT_STABLE":
            crossStateEvidence.directStable++;
            break;
          case "RECOVERED_STABLE":
            crossStateEvidence.recoveredStable++;
            break;
          case "POSITIONAL_STABLE":
            crossStateEvidence.positionalStable++;
            break;
          case "WRONG_TARGET":
            crossStateEvidence.wrongTarget++;
            break;
          case "NOT_RESOLVED":
            crossStateEvidence.notResolved++;
            break;
          case "HOST_NOT_RESOLVED":
            // A shadow host on the way down broke: as unresolved as a miss
            // for the score, and kept separately so the report names the hop.
            crossStateEvidence.notResolved++;
            crossStateEvidence.hostChainBroken++;
            if (
              crossStateEvidence.hostChainBreaks.length <
                MAX_HOST_CHAIN_BREAK_SAMPLES &&
              r.hostSelector !== undefined
            ) {
              crossStateEvidence.hostChainBreaks.push({
                frameId,
                hop: r.brokenAtHop ?? 0,
                hostSelector: r.hostSelector,
              });
            }
            break;
          case "AMBIGUOUS":
            // Consumes the denominator (a genuine, if inconclusive,
            // attempt) without claiming any specific stability verdict.
            break;
        }
      }
    }
    if (attemptedAny) crossStateEvidence.statesTested++;
  }

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

  const queue: QueueItem[] = [
    { kind: "url", url: seedUrl!, source: "seed", sourceStateId: seedStateId },
  ];
  queuedUrls.add(urlIdentity(seedUrl!));
  const pages: PageAuditRecord[] = [];
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
            discoverySource: "same-origin-link",
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
    const candidates: FrameTaggedSafeNavigationCandidate[] =
      await collectSafeNavigationCandidates(tabId).catch(() => []);
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
      traversalEvidence.seedNavigationCandidates = candidates.filter(
        (candidate) => isSafeNavigationCandidate(candidate),
      ).length;
      decideTraversal();
    }
  }

  while (
    queue.length > 0 &&
    auditedCount < limits.maxPages &&
    Date.now() - startedAt < limits.maxTotalAuditMs
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

      const auditOutcome = await collectDomHealthAudit(tabId, { ignoredRoots });
      if (!auditOutcome.available) {
        pages.push({
          url: next.url,
          title: null,
          discoverySource: next.source,
          status: "failed",
          failureReason: auditOutcome.error,
        });
        continue;
      }

      auditedCount++;

      pages.push({
        url: auditOutcome.url,
        title: null,
        discoverySource: next.source,
        status: "completed",
        result: auditOutcome,
        transitionReason: "url",
        frameAccessibility: auditOutcome.frameAccessibility,
      });

      if (next.source === "seed") {
        seedElementPathSamples = auditOutcome.elementPathSamples;
      } else {
        await replaySeedPathsAgainstCurrentState();
      }

      if (auditedCount >= limits.maxPages) break;
      if (Date.now() - startedAt >= limits.maxTotalAuditMs) break;

      // "page" mode never explores beyond the seed state at all — no link
      // discovery, no candidate discovery, no navigation away from it.
      if (discoveryMode !== "page") {
        await discoverFromCurrentState(auditOutcome.url, stateId);
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
    const beforeFingerprint = await capture();
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
        status: "not-discovered",
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

    const auditOutcome = await collectDomHealthAudit(tabId, { ignoredRoots });
    if (!auditOutcome.available) {
      pages.push({
        url: `${next.fromUrl}#control:${next.domPath}`,
        title: next.candidateText,
        discoverySource: "safe-navigation-control",
        status: "failed",
        failureReason: auditOutcome.error,
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
      url: auditOutcome.url,
      title: null,
      discoverySource: "safe-navigation-control",
      status: "completed",
      result: auditOutcome,
      transitionReason: `structural signal changed after clicking "${next.candidateText}": ${reasonSuffix}`,
      frameAccessibility: auditOutcome.frameAccessibility,
    });

    // A click-driven state is never the seed itself — always replay the
    // seed's captured paths against it.
    await replaySeedPathsAgainstCurrentState();

    if (auditedCount >= limits.maxPages) break;
    if (Date.now() - startedAt >= limits.maxTotalAuditMs) break;

    await discoverFromCurrentState(auditOutcome.url, transition.stateId);
  }

  const result = buildApplicationAuditResult(pages, generateAuditId(), {
    discoveryMethod:
      discoveryMode === "page"
        ? "single-page-only"
        : allowClickDiscovery
          ? "anchor-links+navigation-controls"
          : "anchor-links",
    stateGraph: buildStateGraphSummary(graph),
    restorations,
    crossStateEvidence,
    traversal: {
      ...traversal,
      clicksAllowed: allowClickDiscovery,
      evidence: { ...traversalEvidence },
      history: traversalHistory,
    },
  });
  return redactDomHealthOutput({ available: true, ...result });
}
