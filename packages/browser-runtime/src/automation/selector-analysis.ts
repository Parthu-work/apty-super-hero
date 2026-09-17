/**
 * Selector stability analysis.
 *
 * Apty's core recurring debugging question is "why can't Studio/a Workflow
 * select this element" — almost always because the selector configured
 * for it (or the one an engineer is about to hand-configure) is unstable:
 * a framework-generated dynamic id, an ambiguous class shared by many
 * elements, or a structural path that breaks the moment the DOM changes.
 *
 * This module is pure and deterministic — it never touches the browser.
 * Given a description of an element (and optionally how many elements a
 * candidate selector actually matches live, from `tools/selector.ts`), it
 * generates ranked candidate selectors with human-readable reasons, e.g.:
 *
 *   ❌ #input-928731 — looks dynamically generated (numeric/hash suffix)
 *   ⚠️ .MuiInputBase-input — matches 8 elements on the page, not unique
 *   ✅ [data-apty-id="patient-name"] — unique and not dynamic-looking
 *
 * `looksDynamic` is re-exported from `@aipexstudio/dom-snapshot` (the DOM
 * Health feature's selector engine) rather than duplicated here, so "does
 * this id/class look machine-generated" has exactly one definition across
 * the codebase.
 */
import { looksDynamic } from "@aipexstudio/dom-snapshot";

export { looksDynamic };

export interface ElementDescriptor {
  tagName: string;
  id?: string;
  classes: string[];
  /** All attributes on the element, including `id`/`class` (kept here too for convenience). */
  attributes: Record<string, string>;
  textContent?: string;
  /** Ancestors from closest to furthest, for structural (nth-child path) candidates. Text content is not needed for ancestors. */
  ancestors?: ElementDescriptor[];
  /** Whether the element sits inside an iframe — affects how portable/stable a selector actually is. */
  inIframe?: boolean;
  /** Whether the element sits inside a Shadow DOM subtree — same caveat, `document.querySelector` cannot pierce shadow roots. */
  inShadowDom?: boolean;
}

export type SelectorCandidateType =
  | "data-apty"
  | "id"
  | "aria"
  | "class"
  | "attribute"
  | "text"
  | "structural";

export interface SelectorCandidate {
  selector: string;
  type: SelectorCandidateType;
  /** Static risk from the selector's shape alone, before checking against the live DOM. */
  staticRisk: "low" | "medium" | "high";
  reasons: string[];
}

export interface LiveSelectorResult {
  /** How many elements this selector currently matches on the live page. */
  matchCount: number;
  /** Whether the intended target element is among the matches. */
  matchesTarget: boolean;
}

export type SelectorVerdict = "recommended" | "risky" | "broken";

export interface RankedSelectorCandidate extends SelectorCandidate {
  live?: LiveSelectorResult;
  verdict: SelectorVerdict;
  /** Combined static + live explanation, e.g. "unique and not dynamic-looking" or "matches 8 elements, not unique". */
  verdictReason: string;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

const APTY_ATTRIBUTE_PATTERN = /^data-apty-/i;
const SEMANTIC_ATTRIBUTES = ["name", "type", "placeholder", "role", "href"];
const ARIA_ATTRIBUTES = ["aria-label", "aria-labelledby", "aria-describedby"];

/**
 * Generate ranked-order candidate selectors for one element description.
 * Order reflects priority (most-preferred first) before any live
 * uniqueness check — `rankCandidates` combines this with live match data.
 */
export function generateSelectorCandidates(
  descriptor: ElementDescriptor,
): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  const attrs = descriptor.attributes ?? {};

  // 1. data-apty-* attributes — Apty's own semantic markers, highest priority.
  for (const [name, value] of Object.entries(attrs)) {
    if (!APTY_ATTRIBUTE_PATTERN.test(name) || !value) continue;
    candidates.push({
      selector: `[${name}="${escapeAttributeValue(value)}"]`,
      type: "data-apty",
      staticRisk: "low",
      reasons: [
        "Apty-owned semantic attribute — intentionally authored, not framework-generated",
      ],
    });
  }

  // 2. Stable id.
  if (descriptor.id) {
    const dynamic = looksDynamic(descriptor.id);
    candidates.push({
      selector: `#${cssEscapeIdent(descriptor.id)}`,
      type: "id",
      staticRisk: dynamic ? "high" : "low",
      reasons: dynamic
        ? ["id looks dynamically generated (numeric/hash/UUID-like suffix)"]
        : ["Stable-looking id"],
    });
  }

  // 3. aria attributes (accessible name is usually author-controlled, not generated).
  for (const attr of ARIA_ATTRIBUTES) {
    const value = attrs[attr];
    if (!value) continue;
    candidates.push({
      selector: `[${attr}="${escapeAttributeValue(value)}"]`,
      type: "aria",
      staticRisk: "low",
      reasons: [
        `Accessible-name attribute (${attr}) — usually authored for accessibility, not generated`,
      ],
    });
  }

  // 4. Semantic attributes (name/type/placeholder/role/href).
  for (const attr of SEMANTIC_ATTRIBUTES) {
    const value = attrs[attr];
    if (!value) continue;
    candidates.push({
      selector: `${descriptor.tagName.toLowerCase()}[${attr}="${escapeAttributeValue(value)}"]`,
      type: "attribute",
      staticRisk: "medium",
      reasons: [
        `Semantic ${attr} attribute — usually stable but not guaranteed unique`,
      ],
    });
  }

  // 5. Class-based candidates — skip dynamic-looking classes entirely.
  const stableClasses = (descriptor.classes ?? []).filter(
    (c) => c && !looksDynamic(c),
  );
  const dynamicClassCount =
    (descriptor.classes ?? []).length - stableClasses.length;
  if (stableClasses.length > 0) {
    candidates.push({
      selector: `${descriptor.tagName.toLowerCase()}.${stableClasses.map(cssEscapeIdent).join(".")}`,
      type: "class",
      staticRisk: stableClasses.length === 1 ? "medium" : "low",
      reasons:
        dynamicClassCount > 0
          ? [
              `Combines ${stableClasses.length} stable class(es); ${dynamicClassCount} dynamic-looking class(es) on this element were excluded`,
            ]
          : [`Combines ${stableClasses.length} class(es)`],
    });
  } else if ((descriptor.classes ?? []).length > 0) {
    candidates.push({
      selector: `${descriptor.tagName.toLowerCase()}.${descriptor.classes.map(cssEscapeIdent).join(".")}`,
      type: "class",
      staticRisk: "high",
      reasons: ["Every class on this element looks dynamically generated"],
    });
  }

  // 6. Text-based candidate (XPath — CSS has no native text-content selector).
  const text = (descriptor.textContent ?? "").trim();
  if (text && text.length <= 80) {
    candidates.push({
      selector: `//${descriptor.tagName.toLowerCase()}[normalize-space(text())="${text.replace(/"/g, "'")}"]`,
      type: "text",
      staticRisk: "medium",
      reasons: [
        "XPath text match — stable if the copy doesn't change, breaks on i18n/copy edits",
      ],
    });
  }

  // 7. Structural path (last resort).
  if (descriptor.ancestors && descriptor.ancestors.length > 0) {
    const pathParts = [...descriptor.ancestors]
      .reverse()
      .map((a) => a.tagName.toLowerCase());
    pathParts.push(descriptor.tagName.toLowerCase());
    candidates.push({
      selector: pathParts.join(" > "),
      type: "structural",
      staticRisk: "high",
      reasons: [
        "Structural path — breaks if any ancestor's markup changes, e.g. a wrapper div is added/removed",
      ],
    });
  }

  const contextNotes: string[] = [];
  if (descriptor.inIframe) {
    contextNotes.push(
      "Element is inside an iframe — this selector must be evaluated within that frame's document, not the top-level page",
    );
  }
  if (descriptor.inShadowDom) {
    contextNotes.push(
      "Element is inside a Shadow DOM subtree — document.querySelector cannot pierce shadow roots; the selector must be evaluated inside the shadow root",
    );
  }
  if (contextNotes.length > 0) {
    for (const candidate of candidates) {
      candidate.reasons.push(...contextNotes);
    }
  }

  return candidates;
}

function cssEscapeIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  // Minimal fallback when CSS.escape isn't available (e.g. plain Node test env):
  // escape characters that are invalid at the start of a CSS ident.
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// Ranking (static risk + live uniqueness)
// ---------------------------------------------------------------------------

/**
 * Combine static candidates with (optional) live match data into a final
 * ranked, verdicted list. Candidates with live data are ranked above
 * those without; within each group, order is: recommended > risky > broken,
 * and ties broken by the candidate's original priority order.
 */
export function rankSelectorCandidates(
  candidates: SelectorCandidate[],
  liveResults?: Map<string, LiveSelectorResult>,
): RankedSelectorCandidate[] {
  const ranked = candidates.map((candidate, index) => {
    const live = liveResults?.get(candidate.selector);
    const { verdict, verdictReason } = deriveVerdict(candidate, live);
    return {
      ...candidate,
      live,
      verdict,
      verdictReason,
      _originalIndex: index,
    };
  });

  const verdictWeight: Record<SelectorVerdict, number> = {
    recommended: 0,
    risky: 1,
    broken: 2,
  };

  ranked.sort((a, b) => {
    if (verdictWeight[a.verdict] !== verdictWeight[b.verdict]) {
      return verdictWeight[a.verdict] - verdictWeight[b.verdict];
    }
    return a._originalIndex - b._originalIndex;
  });

  return ranked.map(({ _originalIndex: _drop, ...rest }) => rest);
}

function deriveVerdict(
  candidate: SelectorCandidate,
  live: LiveSelectorResult | undefined,
): { verdict: SelectorVerdict; verdictReason: string } {
  if (!live) {
    // No live data — judge on static risk alone.
    if (candidate.staticRisk === "high") {
      return {
        verdict: "risky",
        verdictReason: candidate.reasons.join("; "),
      };
    }
    return {
      verdict: candidate.staticRisk === "low" ? "recommended" : "risky",
      verdictReason: candidate.reasons.join("; "),
    };
  }

  if (live.matchCount < 0) {
    return {
      verdict: "broken",
      verdictReason:
        "Selector is invalid or failed to evaluate against the live page",
    };
  }

  if (live.matchCount === 0) {
    return {
      verdict: "broken",
      verdictReason: "Matches 0 elements on the live page",
    };
  }

  if (!live.matchesTarget) {
    return {
      verdict: "broken",
      verdictReason: `Matches ${live.matchCount} element(s), but not the intended target`,
    };
  }

  if (live.matchCount > 1) {
    return {
      verdict: "risky",
      verdictReason: `Matches ${live.matchCount} elements, not unique`,
    };
  }

  // Unique match on the target — but a dynamic-looking value is still a
  // future-breakage risk even though it works right now.
  if (candidate.staticRisk === "high") {
    return {
      verdict: "risky",
      verdictReason: `Unique right now, but ${candidate.reasons[0]?.toLowerCase() ?? "looks unstable"}`,
    };
  }

  return {
    verdict: "recommended",
    verdictReason: "Unique and not dynamic-looking",
  };
}

/** Render a ranked list in the compact ✅/⚠️/❌ format from the product spec. */
export function formatSelectorReport(
  ranked: RankedSelectorCandidate[],
): string {
  if (ranked.length === 0) {
    return "No candidate selectors could be generated for this element.";
  }
  const icon: Record<SelectorVerdict, string> = {
    recommended: "✅",
    risky: "⚠️",
    broken: "❌",
  };
  return ranked
    .map(
      (c) => `${icon[c.verdict]} ${c.selector}\n   Reason: ${c.verdictReason}`,
    )
    .join("\n");
}
