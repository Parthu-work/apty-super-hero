/**
 * What is not the application (D4): Apty's own Widget and Studio markup,
 * password managers and other extensions, and the overlay vendors in
 * `DEFAULT_IGNORED_ROOTS`. A schema 1 profile has no elements, only
 * values, so each tag, id, class token, attribute name and `src` value is
 * matched on its own with the same matcher the collector uses for whole
 * subtrees. An element inside a noise subtree whose own values carry no
 * marker cannot be recognised from such a profile.
 */
import {
  BROWSER_EXTENSION,
  describeMatcher,
  type IgnoredRootMatcher,
  type IgnoredRootTarget,
  ignoredRootPolicy,
  matchIgnoredRootTarget,
  type NoiseSource,
  noiseSourceOf,
} from "@apty/dom-snapshot";
import { EXTENSION_Z_INDEX } from "./limits.js";

export interface NoiseHit {
  matcher: string;
  owner: string;
  source: NoiseSource;
}

export type NoisePolicy = readonly IgnoredRootMatcher[];

export function noisePolicy(userEntries: readonly string[] = []): NoisePolicy {
  return ignoredRootPolicy(userEntries);
}

function hit(target: IgnoredRootTarget, policy: NoisePolicy): NoiseHit | null {
  const m = matchIgnoredRootTarget(target, policy);
  return m
    ? {
        matcher: describeMatcher(m),
        owner: m.owner,
        source: noiseSourceOf(m.owner),
      }
    : null;
}

export function tagNoise(tag: string, policy: NoisePolicy): NoiseHit | null {
  return hit({ tag }, policy);
}

export function classNoise(
  token: string,
  policy: NoisePolicy,
): NoiseHit | null {
  return hit({ classes: [token] }, policy);
}

export function attributeNameNoise(
  name: string,
  policy: NoisePolicy,
): NoiseHit | null {
  return hit({ attributeNames: [name] }, policy);
}

const INLINE_Z_INDEX = /z-index\s*:\s*(\d+)/i;

/** The z-index a `style` value sets, or null. */
export function inlineZIndex(style: string): number | null {
  const match = style.match(INLINE_Z_INDEX);
  return match ? Number(match[1]) : null;
}

const EXTENSION_ICON: NoiseHit = {
  matcher: `style:z-index>=${EXTENSION_Z_INDEX}`,
  owner: BROWSER_EXTENSION,
  source: "extension",
};

/** Noise carried by one attribute value: an id, a `src`, or an inline z-index only an extension icon uses. */
export function attributeValueNoise(
  name: string,
  value: string,
  policy: NoisePolicy,
): NoiseHit | null {
  if (name === "id") return hit({ id: value }, policy);
  if (name === "src") return hit({ src: value }, policy);
  if (name === "style") {
    const z = inlineZIndex(value);
    return z !== null && z >= EXTENSION_Z_INDEX ? EXTENSION_ICON : null;
  }
  return null;
}

/**
 * D4's unconfirmed entries: reported when present, never applied.
 * `data-qa*` is often an application's own test attribute.
 */
export function unconfirmedNoiseMarker(
  kind: "attribute" | "id" | "class",
  text: string,
): string | null {
  const lower = text.toLowerCase();
  if (kind === "attribute") {
    if (lower.startsWith("data-qa")) return "data-qa*";
    if (lower === "data-emotion") return "data-emotion";
    if (lower === "data-s") return "data-s";
    return null;
  }
  return lower.startsWith("_goober") ? "_goober" : null;
}
