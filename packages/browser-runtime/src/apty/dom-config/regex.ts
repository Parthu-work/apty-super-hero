/**
 * Regex generalization for ignore rules (R1.5): metacharacters escaped,
 * digit runs as `\d+`, anchored `^…$`, alternation with a plain `|`. A
 * literal piece of a pattern comes from page data, so it is allowed only
 * when it is identifier-shaped and carries no PII shape (D3).
 */
import { DOM_CONFIG_LIMITS } from "./limits.js";
import { compareText, DIGIT_SLOT, isSafeLiteral } from "./text.js";

const METACHARACTERS = /[\\^$.*+?()[\]{}|/]/g;

export function escapeRegexLiteral(text: string): string {
  return text.replace(METACHARACTERS, "\\$&");
}

export interface SkeletonRegex {
  /** Without the anchors. */
  body: string;
  literals: string[];
}

export function regexFromSkeleton(skeleton: string): SkeletonRegex {
  const literals = skeleton.split(DIGIT_SLOT);
  return { body: literals.map(escapeRegexLiteral).join("\\d+"), literals };
}

export function literalsAreSafe(literals: readonly string[]): boolean {
  return literals.every((literal) => literal === "" || isSafeLiteral(literal));
}

export function anchored(body: string): string {
  return `^${body}$`;
}

const compiled = new Map<string, RegExp | null>();

/** The compiled pattern, or null when it is too long or does not compile. */
export function compileRuleRegex(source: string): RegExp | null {
  if (source.length > DOM_CONFIG_LIMITS.maxRegexLength) return null;
  if (!compiled.has(source)) {
    let regex: RegExp | null;
    try {
      regex = new RegExp(source);
    } catch {
      regex = null;
    }
    if (compiled.size > 10_000) compiled.clear();
    compiled.set(source, regex);
  }
  return compiled.get(source) ?? null;
}

/** A regex body as tokens that must not be split: `\d+`, an escaped character, or one character. */
function tokens(body: string): string[] {
  return body.match(/\\d\+|\\.|[\s\S]/g) ?? [];
}

const MIN_SHARED_PREFIX = 3;

/**
 * One body for several that share a leading part:
 * `ui-id-\d+` and `ui-tab-\d+` become `ui-(?:id|tab)-\d+`. Null when they
 * share too little, when one would be left empty, or when the result would
 * be longer than a rule may be.
 */
export function mergeSharedPrefix(bodies: readonly string[]): string | null {
  if (bodies.length < 2) return null;
  const split = bodies.map(tokens);
  let shared = 0;
  const shortest = Math.min(...split.map((t) => t.length));
  while (
    shared < shortest &&
    split.every((t) => t[shared] === split[0]![shared])
  ) {
    shared++;
  }
  const prefix = split[0]!.slice(0, shared).join("");
  if (prefix.length < MIN_SHARED_PREFIX) return null;
  const rests = [...new Set(split.map((t) => t.slice(shared).join("")))];
  if (rests.some((rest) => rest === "")) return null;
  rests.sort(compareText);
  const merged = `${prefix}(?:${rests.join("|")})`;
  return anchored(merged).length <= DOM_CONFIG_LIMITS.maxRegexLength
    ? merged
    : null;
}
