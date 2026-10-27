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
import type { ElementPathSample } from "@apty/dom-snapshot";
import {
  type ApplicationAuditLimits,
  type ApplicationAuditProgress,
  type ApplicationDiscoveryMode,
  type CrawlRow,
  crawlApplication,
} from "./application-crawl.js";
import {
  type ApplicationAuditResult,
  buildApplicationAuditResult,
  type CrossStateSelectorEvidence,
  type PageAuditRecord,
  type StateGraphSummary,
} from "./application-scoring.js";
import {
  collectDomHealthAudit,
  type DomHealthAuditOutcome,
  withThresholdOverrides,
} from "./dom-health.js";
import { redactDomHealthOutput } from "./dom-health-redaction.js";
import { useThresholdOverrides } from "./dom-health-thresholds.js";
import {
  type ElementPathReplaySample,
  replayElementPathSamplesInFrame,
} from "./page-navigation.js";
import { summarizeRouteKey } from "./route-key.js";
import { isSameUrl, type StateGraph } from "./state-graph.js";
import { corroboratingSignals } from "./traversal-strategy.js";

export type {
  ApplicationAuditLimits,
  ApplicationAuditProgress,
  ApplicationDiscoveryMode,
} from "./application-crawl.js";
export { DEFAULT_APPLICATION_MAX_PAGES } from "./application-crawl.js";

export interface RunApplicationAuditOptions extends ApplicationAuditLimits {
  onProgress?: (progress: ApplicationAuditProgress) => void;
  /** Defaults to "application-safe" — never silently "application-deep". See `ApplicationDiscoveryMode`. */
  discoveryMode?: ApplicationDiscoveryMode;
  /** Settings entries excluded on top of the default ignored roots. */
  ignoredRoots?: readonly string[];
  /** Developer tools' `domHealthThresholdOverrides`; validated by `resolveThresholds`. */
  thresholdOverrides?: unknown;
  /** Checked between states: the audit stops and scores the states it reached. */
  signal?: AbortSignal;
}

export type ApplicationAuditOutcome =
  | ({
      available: true;
      /** Stopped by `signal` before the crawl finished; the result covers what it reached. */
      stopped?: true;
    } & ApplicationAuditResult)
  | { available: false; error: string };

let auditSequence = 0;
function generateAuditId(): string {
  auditSequence += 1;
  return `app-dom-health-${Date.now()}-${auditSequence}`;
}

/** How many host-chain breaks are kept, with their hop and host selector, as examples in the report. */
const MAX_HOST_CHAIN_BREAK_SAMPLES = 5;

type CompletedAudit = Extract<DomHealthAuditOutcome, { available: true }>;

function toPageAuditRecord({
  visit,
  ...row
}: CrawlRow<CompletedAudit>): PageAuditRecord {
  return visit
    ? { ...row, result: visit, frameAccessibility: visit.frameAccessibility }
    : row;
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
  const discoveryMode: ApplicationDiscoveryMode =
    options.discoveryMode ?? "application-safe";
  const allowClickDiscovery = discoveryMode === "application-deep";
  const thresholds = useThresholdOverrides(options.thresholdOverrides);

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
  const crawl = await crawlApplication<CompletedAudit>(tabId, {
    ...options,
    discoveryMode,
    visit: async ({ source }) => {
      const auditOutcome = await collectDomHealthAudit(tabId, { ignoredRoots });
      if (!auditOutcome.available) return auditOutcome;
      if (source === "seed") {
        seedElementPathSamples = auditOutcome.elementPathSamples;
      } else {
        await replaySeedPathsAgainstCurrentState();
      }
      return { available: true, url: auditOutcome.url, visit: auditOutcome };
    },
  });
  if (!crawl.available) return crawl;
  const { graph, restorations, traversal } = crawl.result;
  const pages = crawl.result.rows.map(toPageAuditRecord);

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
      mode: traversal.mode,
      reason: traversal.reason,
      clicksAllowed: allowClickDiscovery,
      evidence: traversal.evidence,
      history: traversal.history,
    },
  });
  return redactDomHealthOutput(
    withThresholdOverrides(
      {
        available: true as const,
        ...result,
        ...(crawl.result.aborted ? { stopped: true as const } : {}),
      },
      thresholds,
    ),
  );
}
