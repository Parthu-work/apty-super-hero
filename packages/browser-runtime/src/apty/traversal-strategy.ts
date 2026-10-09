/**
 * How the application audit moves between states (DOM Health brief,
 * sections 4.5 and 4.6), decided from what the run observes rather than
 * from which application it is.
 *
 * - URL-first: load each discovered link's URL. Works when links lead to
 *   distinct pages and loading a recorded URL shows the same screen again.
 * - Click-first: explore navigation controls first, and restore a state by
 *   replaying the clicks that reached it. Needed where navigation happens
 *   inside frames by click: the Infor LN top document has no `<a href>`
 *   links at all and its screens change without a URL change, and
 *   athenaOne navigates its frames from script (measured: the LN export's
 *   top document yields 0 discoverable links and 2 navigation controls; the
 *   athenaOne frameset exports yield 0 links in the top document).
 *
 * The mode only orders work and chooses how to restore. Clicking still
 * needs `discoveryMode: "application-deep"`; when the evidence calls for
 * click-first and clicks are off, the report says so.
 */

import { urlTemplate } from "./frame-identity.js";
import type { ObservedTabRequest } from "./network-capture-session.js";
import { type FrameSignatureEntry, frameUrlTemplate } from "./route-key.js";

export type TraversalMode = "url-first" | "click-first";

export interface TraversalEvidence {
  /** Distinct URL templates among the safe same-origin links found at the seed state, the seed's own excluded. */
  seedLinkTemplates: number;
  /** Safe navigation controls found at the seed state. */
  seedNavigationCandidates: number;
  /** Transitions recorded so far. */
  edges: number;
  /** Of those, transitions that kept the same URL template. */
  sameUrlEdges: number;
  /** Restorations attempted by loading a state's URL directly. */
  urlRestorations: number;
  /** Of those, loads that did not reproduce the state's RouteKey. */
  urlRestorationFailures: number;
}

export interface TraversalModeChange {
  mode: TraversalMode;
  reason: string;
  /** States known when the change was made. */
  afterStates: number;
}

export interface TraversalReport {
  mode: TraversalMode;
  reason: string;
  /** Whether this run may click at all (`discoveryMode: "application-deep"`). */
  clicksAllowed: boolean;
  evidence: TraversalEvidence;
  /** Every decision, in order: the seed decision first, then each change. */
  history: TraversalModeChange[];
}

export const EMPTY_TRAVERSAL_EVIDENCE: TraversalEvidence = {
  seedLinkTemplates: 0,
  seedNavigationCandidates: 0,
  edges: 0,
  sameUrlEdges: 0,
  urlRestorations: 0,
  urlRestorationFailures: 0,
};

/**
 * Below this many distinct link targets at the seed, links cannot carry
 * the traversal. A single link (a help page, a logout) does not reach an
 * application; LN and athenaOne have none. Not tuned against an
 * application with exactly one or two links: unverified.
 */
export const MIN_SEED_LINKS_FOR_URL_FIRST = 2;
/** Same-URL transitions only decide once there are at least this many transitions to judge from. */
export const MIN_EDGES_FOR_SAME_URL_RATIO = 3;
/** At or above this share of same-URL transitions, the URL is not where navigation shows. Unverified threshold: half is the point where URLs stop describing most of the moves. */
export const SAME_URL_RATIO_FOR_CLICK_FIRST = 0.5;

/** Rules in order of strength of evidence: a failed URL restoration is proof, the same-URL share is observation, the seed's link count is a prediction. */
export function chooseTraversalMode(evidence: TraversalEvidence): {
  mode: TraversalMode;
  reason: string;
} {
  if (evidence.urlRestorationFailures > 0) {
    return {
      mode: "click-first",
      reason: `Loading a recorded URL did not reproduce its screen (${evidence.urlRestorationFailures} of ${evidence.urlRestorations} direct loads), so states are restored by replaying clicks.`,
    };
  }
  if (
    evidence.edges >= MIN_EDGES_FOR_SAME_URL_RATIO &&
    evidence.sameUrlEdges / evidence.edges >= SAME_URL_RATIO_FOR_CLICK_FIRST
  ) {
    return {
      mode: "click-first",
      reason: `${evidence.sameUrlEdges} of ${evidence.edges} observed transitions kept the same URL template: the screen changes without the URL.`,
    };
  }
  if (
    evidence.seedLinkTemplates < MIN_SEED_LINKS_FOR_URL_FIRST &&
    evidence.seedNavigationCandidates > evidence.seedLinkTemplates
  ) {
    return {
      mode: "click-first",
      reason: `The seed state has ${evidence.seedLinkTemplates} distinct link target(s) and ${evidence.seedNavigationCandidates} navigation control(s): navigation is by click.`,
    };
  }
  return {
    mode: "url-first",
    reason:
      evidence.urlRestorations > 0
        ? `Links at the seed lead to ${evidence.seedLinkTemplates} distinct URL template(s), and every direct load so far (${evidence.urlRestorations}) reproduced its screen.`
        : `Links at the seed lead to ${evidence.seedLinkTemplates} distinct URL template(s).`,
  };
}

/** Evidence, beyond the DOM, that a click navigated somewhere. Never identity on its own (brief section 4.6). */
export interface TransitionCorroboration {
  /** pushState / replaceState / popstate / hashchange calls the click caused. */
  historyEvents: number;
  /** Application or chrome frames that appeared or whose URL template changed. */
  frameSrcChanges: string[];
  /** XHR/Fetch URL templates first seen after the click; null when no network capture was running (it is off by default). */
  newRequestTemplates: string[] | null;
}

const NAVIGATION_FRAME_ROLES = new Set(["application", "chrome"]);

/** Frames, by stable key, that appeared or loaded a different URL template between the two captures. Shims, overlays and placeholders are ignored: athenaOne opens a shim frame per menu. */
export function frameSrcChanges(
  before: FrameSignatureEntry[],
  after: FrameSignatureEntry[],
): string[] {
  const templateBefore = new Map(
    before.map((entry) => [entry.frameKey, frameUrlTemplate(entry)]),
  );
  return after
    .filter((entry) => NAVIGATION_FRAME_ROLES.has(entry.frameRole))
    .filter(
      (entry) => templateBefore.get(entry.frameKey) !== frameUrlTemplate(entry),
    )
    .map((entry) => entry.frameKey)
    .sort();
}

/** URL templates of requests after the click that were not already being made before it, so a polling endpoint does not count. */
export function newRequestTemplates(
  before: ObservedTabRequest[],
  after: ObservedTabRequest[],
): string[] {
  const seen = new Set(
    before.map((request) => urlTemplate(request.url).template),
  );
  const fresh = new Set<string>();
  for (const request of after) {
    const template = urlTemplate(request.url).template;
    if (!seen.has(template)) fresh.add(template);
  }
  return [...fresh].sort();
}

export function corroboratingSignals(
  corroboration: TransitionCorroboration,
): Array<"history" | "frame-src" | "network"> {
  const signals: Array<"history" | "frame-src" | "network"> = [];
  if (corroboration.historyEvents > 0) signals.push("history");
  if (corroboration.frameSrcChanges.length > 0) signals.push("frame-src");
  if ((corroboration.newRequestTemplates?.length ?? 0) > 0) {
    signals.push("network");
  }
  return signals;
}

export function describeCorroboration(
  corroboration: TransitionCorroboration,
): string {
  const parts: string[] = [];
  if (corroboration.historyEvents > 0) {
    parts.push(`${corroboration.historyEvents} history API call(s)`);
  }
  if (corroboration.frameSrcChanges.length > 0) {
    parts.push(
      `a new URL in frame(s) ${corroboration.frameSrcChanges.join(", ")}`,
    );
  }
  if (corroboration.newRequestTemplates?.length) {
    parts.push(
      `${corroboration.newRequestTemplates.length} new XHR/fetch request(s)`,
    );
  }
  if (corroboration.newRequestTemplates === null) {
    parts.push("network capture off");
  }
  return parts.length > 0 ? parts.join(", ") : "nothing";
}
