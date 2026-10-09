/**
 * `RouteKey`: which screen of the application the tab is showing, built so
 * that the URL is one contributing signal and never the only one (DOM
 * Health brief, section 4.3).
 *
 * The previous state fingerprint hashed each frame's raw URL and title and
 * keyed every frame by its `frameId` (defect D-3). None of those survives
 * what the real applications do: `frameId`s are assigned per page load,
 * Infor LN's frame URL carries `inforTenantId` and
 * `inforSessionId=<tenant>~<GUID>`, and athenaOne's URL path and title
 * carry the practice id and name. The same screen therefore looked like a
 * new state in every tenant, practice and session, and a correctly
 * restored state compared as different.
 *
 * A `RouteKey` is built from per-frame `FrameStateSignature`s and the frame
 * identity layer (`frame-identity.ts`):
 *
 * - `appFrameKey`: the stable keys of the frames holding the application
 *   (role `application`; shells, navigation chrome, shims, placeholders
 *   and overlays excluded).
 * - `urlTemplate`: those frames' URLs with ids, tenants, sessions and
 *   per-user parameters removed (`urlTemplate`).
 * - `navTrail`: breadcrumb and selected navigation items from the
 *   application and chrome frames, outermost frame first. Infor OS
 *   Portal's selected tab ("LN") lives in the top document, not in the LN
 *   frame, which is why chrome frames contribute here.
 * - `primaryHeading`: the first application frame's primary heading.
 * - `structureHash`: the application frames' tag/role skeletons.
 *
 * Identity rule: the navigation trail and heading name the screen; when
 * either is present the structure is evidence only, so an expanded
 * accordion or a loaded grid never manufactures a state. Only when both
 * are absent does the structure decide, and such a key is `low`
 * confidence. Text is normalised and identifier runs masked, so "Order
 * 4711" and "Order 4712" are the same screen; a name with no identifying
 * shape is not detected, and two records of one screen whose headings are
 * names compare as different screens.
 */
import { type FrameStateSignature, fnv1a } from "@apty/dom-snapshot";
import { maskIdLike } from "./dom-health-redaction.js";
import { type FrameRole, urlTemplate } from "./frame-identity.js";

export interface FrameSignatureEntry {
  /** This page load's frame id: evidence for debugging, never identity. */
  frameId: number;
  frameKey: string;
  /** False for the positional last-resort key. */
  frameKeyStable: boolean;
  frameRole: FrameRole;
  depth: number;
  /** Template of the frame's URL as the browser reports it; the signature's own URL wins when there is one. */
  urlTemplate: string;
  signature: FrameStateSignature | null;
}

export type RouteSignal =
  | "frame"
  | "urlTemplate"
  | "navTrail"
  | "heading"
  | "structure";

/**
 * - `high`: a navigation trail or heading names the screen, in frames with
 *   stable keys.
 * - `medium`: a trail or heading in a frame keyed only by position, or no
 *   trail or heading but a hash route in the URL template.
 * - `low`: nothing but the structure (and a URL that may be the same for
 *   every screen) tells screens apart.
 */
export type RouteKeyConfidence = "high" | "medium" | "low";

export interface RouteKey {
  /** Stable keys of the frames that own the primary content, outermost first, joined with " + ". */
  appFrameKey: string;
  /** Their URL templates, in the same order, joined with " + ". */
  urlTemplate: string;
  navTrail: string[];
  primaryHeading: string | null;
  structureHash: string;
  /** Which of the above actually carried signal in this observation. */
  contributingSignals: RouteSignal[];
  confidence: RouteKeyConfidence;
}

/** Frames whose navigation counts toward the trail. Shims, placeholders and overlays never do. */
const NAVIGATION_ROLES: ReadonlySet<FrameRole> = new Set([
  "application",
  "chrome",
]);
const MAX_NAV_TRAIL = 8;
const SEPARATOR = " + ";

function byPosition(a: FrameSignatureEntry, b: FrameSignatureEntry): number {
  return (
    a.depth - b.depth ||
    a.frameKey.localeCompare(b.frameKey) ||
    a.urlTemplate.localeCompare(b.urlTemplate)
  );
}

/** Text as identity: whitespace collapsed, identifier-shaped runs masked. */
export function identityText(text: string): string {
  return maskIdLike(text.replace(/\s+/g, " ").trim());
}

/** The application frames, outermost first; the chrome frames when the tab has no application frame at all. */
export function selectAppFrames(
  entries: FrameSignatureEntry[],
): FrameSignatureEntry[] {
  const app = entries.filter((entry) => entry.frameRole === "application");
  const chosen =
    app.length > 0
      ? app
      : entries.filter((entry) => entry.frameRole === "chrome");
  return [...chosen].sort(byPosition);
}

function frameUrlTemplate(entry: FrameSignatureEntry): string {
  return entry.signature?.url
    ? urlTemplate(entry.signature.url).template
    : entry.urlTemplate;
}

function collectNavTrail(entries: FrameSignatureEntry[]): string[] {
  const trail: string[] = [];
  const frames = entries
    .filter((entry) => NAVIGATION_ROLES.has(entry.frameRole))
    .sort(byPosition);
  for (const entry of frames) {
    for (const item of entry.signature?.navTrail ?? []) {
      const text = identityText(item);
      if (text && trail[trail.length - 1] !== text) trail.push(text);
      if (trail.length >= MAX_NAV_TRAIL) return trail;
    }
  }
  return trail;
}

export function buildRouteKey(entries: FrameSignatureEntry[]): RouteKey {
  const appFrames = selectAppFrames(entries);
  const templates = appFrames.map(frameUrlTemplate);
  const navTrail = collectNavTrail(entries);
  const heading =
    appFrames
      .map((entry) => entry.signature?.primaryHeading)
      .find((text): text is string => Boolean(text)) ?? null;
  const primaryHeading = heading ? identityText(heading) : null;
  const structures = appFrames.map(
    (entry) => entry.signature?.structureHash ?? "",
  );
  const structureHash = structures.some(Boolean)
    ? fnv1a(structures.join("|"))
    : "";

  const frameStable =
    appFrames.length > 0 && appFrames.every((entry) => entry.frameKeyStable);
  const contributingSignals: RouteSignal[] = [];
  if (frameStable) contributingSignals.push("frame");
  if (templates.some((template) => /^https?:/.test(template))) {
    contributingSignals.push("urlTemplate");
  }
  if (navTrail.length > 0) contributingSignals.push("navTrail");
  if (primaryHeading) contributingSignals.push("heading");
  if (structureHash) contributingSignals.push("structure");

  const named = navTrail.length > 0 || primaryHeading !== null;
  const hashRouted = templates.some((template) => template.includes("#"));
  const confidence: RouteKeyConfidence =
    named && frameStable ? "high" : named || hashRouted ? "medium" : "low";

  return {
    appFrameKey: appFrames.map((entry) => entry.frameKey).join(SEPARATOR),
    urlTemplate: templates.join(SEPARATOR),
    navTrail,
    primaryHeading,
    structureHash,
    contributingSignals,
    confidence,
  };
}

/** True when the trail or the heading names the screen, so the structure is evidence only. */
export function isNamedRoute(key: RouteKey): boolean {
  return key.navTrail.length > 0 || key.primaryHeading !== null;
}

/** The canonical string two observations must share to be the same state. See the identity rule in the module comment. */
export function routeIdentity(key: RouteKey): string {
  return [
    key.appFrameKey,
    key.urlTemplate,
    key.navTrail.join(" > "),
    key.primaryHeading ?? "",
    isNamedRoute(key) ? "" : key.structureHash,
  ].join("||");
}

const CONFIDENCE_ORDER: RouteKeyConfidence[] = ["low", "medium", "high"];

export function lowerConfidence(
  a: RouteKeyConfidence,
  b: RouteKeyConfidence,
): RouteKeyConfidence {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

/** What a report may show of a key: no trail or heading text, which can name a person. */
export interface RouteKeySummary {
  appFrameKey: string;
  urlTemplate: string;
  contributingSignals: RouteSignal[];
  confidence: RouteKeyConfidence;
}

export function summarizeRouteKey(key: RouteKey): RouteKeySummary {
  return {
    appFrameKey: key.appFrameKey,
    urlTemplate: key.urlTemplate,
    contributingSignals: key.contributingSignals,
    confidence: key.confidence,
  };
}
