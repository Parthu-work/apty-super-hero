/**
 * Application-state identity for the application-wide DOM Health audit
 * (forensic audit RC-5). Combines every accessible frame's
 * `FrameStateSignature` into one `RouteKey` (`route-key.ts`) and a
 * fingerprint of it, so `application-audit.ts` can tell:
 *
 *   STATE A, same URL, different application view  -> a real transition
 *   STATE A, same URL, a live counter ticked        -> the SAME state
 *   STATE A, another tenant, session or frameId     -> the SAME state
 *
 * without depending on the URL changing or on `tabs.onUpdated("complete")`
 * firing (an enterprise app's menu-driven navigation may do neither).
 *
 * `compareStateFingerprints` reports WHICH signal changed, so a "new
 * state" decision is itself evidence, not a black box. Its reasons never
 * quote heading or navigation text, which can name a person.
 */
import { fnv1a } from "@apty/dom-snapshot";
import {
  buildRouteKey,
  type FrameSignatureEntry,
  isNamedRoute,
  lowerConfidence,
  type RouteKey,
  type RouteKeyConfidence,
  routeIdentity,
} from "./route-key.js";

export { fnv1a };
export type { FrameSignatureEntry };

export interface AuditStateFingerprint {
  /** Hash of `routeIdentity(routeKey)` plus the frames that could not be read: equal fingerprints are the same state. */
  fingerprint: string;
  routeKey: RouteKey;
  /** Keys of application and chrome frames whose signature could not be read, sorted. */
  uninspectedFrameKeys: string[];
  /** Per-frame signatures this fingerprint was built from, for evidence/debugging — never re-derived from the fingerprint string itself. */
  frames: FrameSignatureEntry[];
}

export type StateComparison = "same" | "different" | "uncertain";

export interface StateComparisonResult {
  result: StateComparison;
  /** Human-readable reasons a "different"/"uncertain" verdict was reached — empty for "same". */
  reasons: string[];
  /** The lower of the two keys' confidence: a verdict is only as good as its weaker side. */
  confidence: RouteKeyConfidence;
}

function uninspectedKeys(entries: FrameSignatureEntry[]): string[] {
  return entries
    .filter(
      (entry) =>
        !entry.signature &&
        (entry.frameRole === "application" || entry.frameRole === "chrome"),
    )
    .map((entry) => entry.frameKey)
    .sort();
}

/**
 * Combine every frame's signature (or `null` for a frame that could not be
 * inspected) into one whole-tab state fingerprint. Frame order and
 * `frameId`s do not affect the result.
 */
export function computeStateFingerprint(
  entries: FrameSignatureEntry[],
): AuditStateFingerprint {
  const routeKey = buildRouteKey(entries);
  const uninspectedFrameKeys = uninspectedKeys(entries);
  return {
    fingerprint: fnv1a(
      `${routeIdentity(routeKey)}||${uninspectedFrameKeys.join(",")}`,
    ),
    routeKey,
    uninspectedFrameKeys,
    frames: entries,
  };
}

/** The fingerprint of a state that could not be captured at all. */
export function unknownStateFingerprint(): AuditStateFingerprint {
  return {
    fingerprint: "unknown",
    routeKey: {
      appFrameKey: "",
      urlTemplate: "",
      navTrail: [],
      primaryHeading: null,
      structureHash: "",
      contributingSignals: [],
      confidence: "low",
    },
    uninspectedFrameKeys: [],
    frames: [],
  };
}

/**
 * Compare two state fingerprints. "uncertain" whenever a frame could be
 * read at one point and not at the other — the honest answer is "we don't
 * know", never a confident verdict built on a gap in the evidence.
 */
export function compareStateFingerprints(
  a: AuditStateFingerprint,
  b: AuditStateFingerprint,
): StateComparisonResult {
  const confidence = lowerConfidence(
    a.routeKey.confidence,
    b.routeKey.confidence,
  );
  if (a.fingerprint === b.fingerprint) {
    return { result: "same", reasons: [], confidence };
  }

  const reasons: string[] = [];
  const aUninspected = new Set(a.uninspectedFrameKeys);
  const bUninspected = new Set(b.uninspectedFrameKeys);
  const readOnOneSideOnly = [
    ...a.uninspectedFrameKeys.filter((key) => !bUninspected.has(key)),
    ...b.uninspectedFrameKeys.filter((key) => !aUninspected.has(key)),
  ];
  for (const key of readOnOneSideOnly) {
    reasons.push(
      `frame "${key}" could not be inspected at one of the two points compared`,
    );
  }

  const ka = a.routeKey;
  const kb = b.routeKey;
  if (ka.appFrameKey !== kb.appFrameKey) {
    reasons.push(
      `the application frame changed ("${ka.appFrameKey}" -> "${kb.appFrameKey}")`,
    );
  }
  if (ka.urlTemplate !== kb.urlTemplate) {
    reasons.push(
      `the URL template changed ("${ka.urlTemplate}" -> "${kb.urlTemplate}")`,
    );
  }
  if (ka.navTrail.join(">") !== kb.navTrail.join(">")) {
    reasons.push("the navigation trail changed");
  }
  if (ka.primaryHeading !== kb.primaryHeading) {
    reasons.push("the primary heading changed");
  }
  if (
    !isNamedRoute(ka) &&
    !isNamedRoute(kb) &&
    ka.structureHash !== kb.structureHash
  ) {
    reasons.push(
      "only the structure of the primary content changed; no navigation trail or heading confirms it (low confidence)",
    );
  }

  if (readOnOneSideOnly.length > 0) {
    return { result: "uncertain", reasons, confidence };
  }
  if (reasons.length === 0) reasons.push("the state identity changed");
  return { result: "different", reasons, confidence };
}
