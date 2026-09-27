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
  isSafeNavigationCandidate,
  isSafeToDiscover,
} from "@apty/dom-snapshot";
import {
  type ApplicationAuditResult,
  buildApplicationAuditResult,
  type PageAuditRecord,
  type RestorationEvidence,
  type StateGraphSummary,
} from "./application-scoring.js";
import { isUnsupportedPage, runDomHealthAudit } from "./dom-health.js";
import {
  captureApplicationState,
  toFrameSignatureEntries,
} from "./frame-audit.js";
import {
  clickSafeNavigationCandidate,
  collectPageLinks,
  collectSafeNavigationCandidates,
  type FrameTaggedLink,
  type FrameTaggedSafeNavigationCandidate,
  getNavigationModel,
  navigateTab,
  waitForDomStable,
} from "./page-navigation.js";
import {
  type AuditStateFingerprint,
  compareStateFingerprints,
  computeStateFingerprint,
} from "./state-fingerprint.js";
import { StateGraph, type StateTransitionEdge } from "./state-graph.js";

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

export interface RunApplicationAuditOptions extends ApplicationAuditLimits {
  onProgress?: (progress: ApplicationAuditProgress) => void;
  /**
   * Off by default, deliberately. When true, a detected safe-navigation
   * candidate (a menu/tab/tree item with no real `<a href>`) may actually
   * be clicked to see whether it produces a new application state — this
   * is the only way to explore a menu-driven enterprise application's
   * other screens automatically, but it is a real click on a live
   * application, so it is never enabled unless the caller explicitly asks
   * for it.
   */
  allowClickDiscovery?: boolean;
}

export type ApplicationAuditOutcome =
  | ({ available: true } & ApplicationAuditResult)
  | { available: false; error: string };

let auditSequence = 0;
function generateAuditId(): string {
  auditSequence += 1;
  return `app-dom-health-${Date.now()}-${auditSequence}`;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

interface UrlQueueItem {
  kind: "url";
  url: string;
  source: "seed" | "same-origin-link";
  /** Which graph state was live when this URL was discovered/queued — kept for graph completeness even though URL items always restore by direct navigation. */
  sourceStateId: string;
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
): Promise<AuditStateFingerprint | null> {
  const outcome = await captureApplicationState(tabId, {
    sequenceIndex: 0,
  }).catch(() => null);
  if (!outcome || !outcome.available) return null;
  return computeStateFingerprint(
    toFrameSignatureEntries(outcome.result.frames),
  );
}

/**
 * Restore the live tab to `targetStateId` before acting on one of its
 * children, by replaying the exact recorded path of transitions from the
 * seed state (`graph.getRestorationPath`) — verifying the fingerprint at
 * every hop against what was originally recorded. A pure-URL path (every
 * edge a real navigation, no click involved) short-circuits to a single
 * direct `navigateTab` to the target's own URL, since that's always cheap
 * and unambiguous; a path containing any click-based edge requires a full
 * reset to the seed URL followed by a faithful replay, because there is no
 * other way to reach a same-URL, click-driven state deterministically.
 * Never pretends success: a hop whose replay doesn't reproduce the
 * originally-recorded fingerprint fails the whole restoration immediately.
 */
async function restoreToState(
  tabId: number,
  seedUrl: string,
  graph: StateGraph,
  targetStateId: string,
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
  if (isPureUrlPath) {
    await navigateTab(tabId, targetNode.url);
    await waitForDomStable(tabId);
    const observed = await captureFingerprint(tabId);
    const success =
      observed?.fingerprint === targetNode.fingerprint.fingerprint;
    if (success) graph.setCurrentStateId(targetStateId);
    return {
      targetStateId,
      success,
      stepCount: path.length,
      failedAtStep: success ? undefined : Math.max(0, path.length - 1),
      reason: success
        ? undefined
        : "Direct navigation to this state's URL did not reproduce its originally-recorded fingerprint.",
    };
  }

  await navigateTab(tabId, seedUrl);
  await waitForDomStable(tabId);

  for (let i = 0; i < path.length; i++) {
    const edge: StateTransitionEdge = path[i]!;
    if (edge.trigger.kind === "click") {
      const clickResult = await clickSafeNavigationCandidate(
        tabId,
        edge.trigger.frameId!,
        edge.trigger.domPath!,
      );
      if (!clickResult.clicked) {
        return {
          targetStateId,
          success: false,
          stepCount: path.length,
          failedAtStep: i,
          reason: `Replaying step ${i + 1}/${path.length} ("${edge.trigger.candidateText ?? edge.trigger.domPath}") failed: ${clickResult.reason ?? "click did not succeed"}.`,
        };
      }
    } else if (edge.trigger.kind === "url-navigation" && edge.trigger.url) {
      await navigateTab(tabId, edge.trigger.url);
    }
    await waitForDomStable(tabId);
    const observed = await captureFingerprint(tabId);
    if (observed?.fingerprint !== edge.afterFingerprint) {
      return {
        targetStateId,
        success: false,
        stepCount: path.length,
        failedAtStep: i,
        reason: `Replaying step ${i + 1}/${path.length} produced a different state than originally recorded — the application may not be deterministically restorable via this path.`,
      };
    }
  }

  graph.setCurrentStateId(targetStateId);
  return { targetStateId, success: true, stepCount: path.length };
}

function buildStateGraphSummary(graph: StateGraph): StateGraphSummary {
  const seedStateId = graph.getSeedStateId();
  const seedNode = seedStateId ? graph.getNode(seedStateId) : undefined;
  return {
    seedStateId,
    nodes: graph.getAllNodes().map((node) => ({
      stateId: node.stateId,
      url: node.url,
      title: node.title,
      sameUrlAsSeed: seedNode
        ? normalizeUrl(node.url) === normalizeUrl(seedNode.url)
        : false,
      discoveredAt: node.discoveredAt,
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
    })),
  };
}

/**
 * Run a full application-wide DOM Health audit starting from the given
 * tab's current page/state. Safe by construction: literal `<a href>`
 * discovery never executes anything, and non-anchor discovery is
 * click-free unless `allowClickDiscovery` is explicitly set; hard limits
 * bound total states, queue size, and wall-clock time.
 */
export async function runApplicationDomHealthAudit(
  tabId: number,
  options: RunApplicationAuditOptions = {},
): Promise<ApplicationAuditOutcome> {
  const limits: Required<ApplicationAuditLimits> = {
    ...DEFAULT_LIMITS,
    ...options,
  };
  const allowClickDiscovery = options.allowClickDiscovery ?? false;
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

  const graph = new StateGraph();
  const seedFingerprint = (await captureFingerprint(tabId)) ?? {
    fingerprint: "unknown-seed",
    frameUrls: [],
    frames: [],
  };
  const seedStateId = graph.addSeedState(seedFingerprint, seedUrl!, null);

  const queue: QueueItem[] = [
    { kind: "url", url: seedUrl!, source: "seed", sourceStateId: seedStateId },
  ];
  queuedUrls.add(normalizeUrl(seedUrl!));
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
      const normalizedLink = normalizeUrl(link.absoluteUrl);
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
  }

  while (
    queue.length > 0 &&
    auditedCount < limits.maxPages &&
    Date.now() - startedAt < limits.maxTotalAuditMs
  ) {
    const next = queue.shift()!;

    if (next.kind === "url") {
      const normalized = normalizeUrl(next.url);
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

      const auditOutcome = await runDomHealthAudit(tabId);
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

      let stateId = graph.getCurrentStateId()!;
      if (next.source !== "seed") {
        const fingerprint =
          (await captureFingerprint(tabId)) ?? seedFingerprint;
        const transition = graph.recordTransition({
          sourceStateId: next.sourceStateId,
          trigger: { kind: "url-navigation", url: next.url },
          beforeFingerprint:
            graph.getNode(next.sourceStateId)?.fingerprint ?? seedFingerprint,
          afterFingerprint: fingerprint,
          url: auditOutcome.url,
          title: auditOutcome.pageTitle,
          historyEventDelta: 0,
        });
        stateId = transition.stateId;
      }

      pages.push({
        url: auditOutcome.url,
        title: auditOutcome.pageTitle,
        discoverySource: next.source,
        status: "completed",
        result: auditOutcome,
        transitionReason: "url",
        frameAccessibility: auditOutcome.frameAccessibility,
      });

      if (auditedCount >= limits.maxPages) break;
      if (Date.now() - startedAt >= limits.maxTotalAuditMs) break;

      await discoverFromCurrentState(auditOutcome.url, stateId);
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
    const beforeFingerprint = await captureFingerprint(tabId);
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
    const afterFingerprint = await captureFingerprint(tabId);
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
    // A click that leaves the structural fingerprint unchanged is only
    // treated as a real transition when real history-API evidence (a
    // pushState/replaceState/popstate/hashchange call this click actually
    // triggered) says a client-side route change happened anyway — real
    // evidence promoted into the discovery decision, not left as
    // diagnostic-only telemetry.
    const isRealTransition =
      comparison.result === "different" ||
      (comparison.result === "same" && historyEventDelta > 0);
    if (!isRealTransition) {
      pages.push({
        url: `${next.fromUrl}#control:${next.domPath}`,
        title: next.candidateText,
        discoverySource: "safe-navigation-control",
        status: "not-discovered",
        failureReason:
          comparison.result === "same"
            ? "Clicking this control did not produce a new application state."
            : "State identity could not be confidently determined after clicking this control.",
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
    });

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

    const auditOutcome = await runDomHealthAudit(tabId);
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
        ? comparison.reasons.join("; ")
        : `no structural signal changed, but ${historyEventDelta} client-side history API call(s) (pushState/replaceState/popstate/hashchange) fired`;
    // No new top-level URL exists for a same-URL state transition — the
    // audited page's own URL is reused, and the fingerprint (recorded in
    // transitionReason) is what actually distinguishes this state.
    pages.push({
      url: auditOutcome.url,
      title: auditOutcome.pageTitle,
      discoverySource: "safe-navigation-control",
      status: "completed",
      result: auditOutcome,
      transitionReason: `structural signal changed after clicking "${next.candidateText}": ${reasonSuffix}`,
      frameAccessibility: auditOutcome.frameAccessibility,
    });

    if (auditedCount >= limits.maxPages) break;
    if (Date.now() - startedAt >= limits.maxTotalAuditMs) break;

    await discoverFromCurrentState(auditOutcome.url, transition.stateId);
  }

  const result = buildApplicationAuditResult(pages, generateAuditId(), {
    discoveryMethod: allowClickDiscovery
      ? "anchor-links+navigation-controls"
      : "anchor-links",
    stateGraph: buildStateGraphSummary(graph),
    restorations,
  });
  return { available: true, ...result };
}
