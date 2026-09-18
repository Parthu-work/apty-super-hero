/**
 * Application-state identity for the application-wide DOM Health audit
 * (forensic audit RC-5). Combines every accessible frame's
 * `FrameStateSignature` (see `@apty/dom-snapshot`'s
 * `health-state-signature.ts`) into one fingerprint for "the current
 * application state", so `application-audit.ts` can tell:
 *
 *   STATE A, same URL, different application view  -> a real transition
 *   STATE A, same URL, a live counter ticked        -> the SAME state
 *
 * without depending on the URL changing or on `tabs.onUpdated("complete")`
 * firing (an enterprise app's menu-driven navigation may do neither).
 *
 * Deliberately a plain, inspectable string comparison, not an opaque hash
 * comparison alone: `compareStateFingerprints` reports WHICH signal
 * changed (url set, a frame's title, its active nav item, its heading
 * sample, or its container-count shape) so a "new state" decision is
 * itself evidence, not a black box.
 */
import type { FrameStateSignature } from "@apty/dom-snapshot";

export interface FrameSignatureEntry {
  frameId: number;
  signature: FrameStateSignature | null;
}

export interface AuditStateFingerprint {
  /** Stable, order-independent identity for the whole state — same inputs always produce the same fingerprint. */
  fingerprint: string;
  /** Every frame's own URL, sorted — the cheapest, most reliable "did the frame set change" signal. */
  frameUrls: string[];
  /** Per-frame signatures this fingerprint was built from, for evidence/debugging — never re-derived from the fingerprint string itself. */
  frames: FrameSignatureEntry[];
}

export type StateComparison = "same" | "different" | "uncertain";

export interface StateComparisonResult {
  result: StateComparison;
  /** Human-readable reasons a "different"/"uncertain" verdict was reached — empty for "same". */
  reasons: string[];
}

function canonicalizeSignature(signature: FrameStateSignature): string {
  const containerCountsCanonical = Object.entries(signature.containerCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return [
    signature.url,
    signature.title,
    signature.activeNavItem ?? "",
    signature.headingSample.join(">"),
    containerCountsCanonical,
  ].join("||");
}

/** FNV-1a 32-bit — no crypto dependency needed; this only has to be stable and cheap, never cryptographically strong. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Combine every frame's signature (or `null` for a frame that could not be
 * inspected) into one whole-tab state fingerprint. Frame order does not
 * affect the result — entries are sorted by `frameId` first.
 */
export function computeStateFingerprint(
  entries: FrameSignatureEntry[],
): AuditStateFingerprint {
  const sorted = [...entries].sort((a, b) => a.frameId - b.frameId);
  const canonicalParts = sorted.map(
    (entry) =>
      `${entry.frameId}:${entry.signature ? canonicalizeSignature(entry.signature) : "<inaccessible>"}`,
  );
  const frameUrls = sorted
    .map((entry) => entry.signature?.url)
    .filter((url): url is string => Boolean(url))
    .sort();

  return {
    fingerprint: fnv1a(canonicalParts.join("")),
    frameUrls,
    frames: sorted,
  };
}

/**
 * Compare two state fingerprints. "uncertain" whenever either side is
 * missing a signature for a frame the other side has (a frame that could
 * not be inspected at one point in time) — the honest answer is "we don't
 * know", never a confident "same" built on a gap in the evidence.
 */
export function compareStateFingerprints(
  a: AuditStateFingerprint,
  b: AuditStateFingerprint,
): StateComparisonResult {
  if (a.fingerprint === b.fingerprint) {
    return { result: "same", reasons: [] };
  }

  const reasons: string[] = [];
  const aUrls = new Set(a.frameUrls);
  const bUrls = new Set(b.frameUrls);
  const urlSetChanged =
    a.frameUrls.length !== b.frameUrls.length ||
    a.frameUrls.some((url) => !bUrls.has(url)) ||
    b.frameUrls.some((url) => !aUrls.has(url));
  if (urlSetChanged) {
    reasons.push(
      `the set of frame URLs changed (was [${a.frameUrls.join(", ")}], now [${b.frameUrls.join(", ")}])`,
    );
  }

  const bByFrameId = new Map(b.frames.map((f) => [f.frameId, f]));
  let anyUncertain = false;
  for (const frameA of a.frames) {
    const frameB = bByFrameId.get(frameA.frameId);
    if (!frameB) continue; // frame disappeared — already covered by the URL-set check above
    if (!frameA.signature || !frameB.signature) {
      anyUncertain = true;
      reasons.push(
        `frame ${frameA.frameId} could not be inspected at one of the two points compared`,
      );
      continue;
    }
    if (frameA.signature.title !== frameB.signature.title) {
      reasons.push(
        `frame ${frameA.frameId}'s title changed ("${frameA.signature.title}" -> "${frameB.signature.title}")`,
      );
    }
    if (frameA.signature.activeNavItem !== frameB.signature.activeNavItem) {
      reasons.push(
        `frame ${frameA.frameId}'s active navigation item changed ("${frameA.signature.activeNavItem ?? "none"}" -> "${frameB.signature.activeNavItem ?? "none"}")`,
      );
    }
    if (
      frameA.signature.headingSample.join(">") !==
      frameB.signature.headingSample.join(">")
    ) {
      reasons.push(`frame ${frameA.frameId}'s heading sample changed`);
    }
  }

  if (anyUncertain) {
    return { result: "uncertain", reasons };
  }
  if (reasons.length === 0) {
    // The fingerprints differed (e.g. a container-count shift) but nothing
    // reached the field-level checks above — still real evidence of change.
    reasons.push("a structural container-count signal changed");
  }
  return { result: "different", reasons };
}
