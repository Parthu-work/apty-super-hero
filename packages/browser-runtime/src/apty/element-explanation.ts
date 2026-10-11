/**
 * DOM Health evidence in the vocabulary of Apty's Dynamic Element Selection
 * (DES): which recovery step would find an element, which values it leaves
 * out as dynamic, why a hit test failed, and what would make the element
 * reliable. Text only from the engine's own per-element evidence
 * (`ElementSelectorReport`) and counts; never page text or attribute
 * values, only attribute names.
 *
 * Step names are the ones in Apty's DES documentation (checkInitialPath,
 * checkSimplifyDynamic, checkSimplifyNth, checkContainers,
 * checkDirectElement). `des-engine.ts` reconstructs the same steps as
 * dropDynamicValues, dropPositionalPseudo, dropOneAncestor and
 * leafFieldCombinations (docs/development/des-engine.md).
 */
import type {
  ElementSelectorReport,
  HitTestClassification,
  SelectorResolutionOutcome,
} from "@apty/dom-snapshot";

export interface ElementExplanation {
  /** How DES would find this element, or why it would not. */
  howFound: string;
  /** Dynamic values left out, shadow roots, hit test and cross-state result, as applicable. */
  notes: string[];
  /** What would make the element reliably selectable; null when nothing is needed. */
  fix: string | null;
}

export interface DesStepCount {
  outcome: SelectorResolutionOutcome;
  step: string;
  elements: number;
  meaning: string;
}

export interface HitTestReasonCount {
  reason: Exclude<
    HitTestClassification,
    "fully-targetable" | "partially-targetable"
  >;
  elements: number;
  meaning: string;
}

export interface DynamicValueCount {
  attribute: string;
  elements: number;
}

/** DES evidence for a whole page or application: steps, dynamic values and hit-test reasons, each with its count. */
export interface DesEvidence {
  steps: DesStepCount[];
  dynamicValuesLeftOut: DynamicValueCount[];
  hitTestReasons: HitTestReasonCount[];
}

const STEPS: Record<
  SelectorResolutionOutcome,
  { step: string; meaning: string }
> = {
  DIRECT_SUCCESS: {
    step: "checkInitialPath",
    meaning:
      "One stable attribute identifies the element: the captured path resolves on the first try.",
  },
  RECOVERED_BY_PARTIAL: {
    step: "Partial Selector",
    meaning:
      "Unique only on the stable part of an attribute value; the changing part is left out by a Partial Selector rule.",
  },
  RECOVERED_BY_IGNORE: {
    step: "checkSimplifyDynamic",
    meaning:
      "No single attribute is unique: several are combined, with dynamic values left out (Ignore Selector).",
  },
  RECOVERED_BY_CONTEXT: {
    step: "checkContainers",
    meaning:
      "Unique only with ancestor context: a change to those containers can break the path.",
  },
  POSITIONAL_ONLY: {
    step: "checkSimplifyNth",
    meaning:
      "Only its position among siblings (nth-child) tells it apart; once position is dropped, checkDirectElement can pick a sibling.",
  },
  AMBIGUOUS: {
    step: "Ambiguous",
    meaning:
      "Two candidates score within 0.03 of each other: DES may pick the look-alike.",
  },
  WRONG_TARGET: {
    step: "Wrong target",
    meaning:
      "DES's best candidate is a different element, e.g. a rendered look-alike preferred over a hidden target.",
  },
  NOT_RESOLVED: {
    step: "Not found",
    meaning:
      "No candidate reaches DES's 0.90 score after every strategy, checkDirectElement included.",
  },
  INACCESSIBLE: {
    step: "Behind a boundary",
    meaning:
      "In a closed shadow root or a frame DES cannot search from the page that holds the path.",
  },
};

const HIT_TEST_MEANING: Record<HitTestReasonCount["reason"], string> = {
  hidden:
    "Hidden by display or visibility when sampled, e.g. a closed menu or an inactive tab.",
  "zero-size":
    "No width or height when sampled: collapsed or not laid out yet. The player can find it but not highlight or click it.",
  "outside-viewport":
    "Outside the viewport when sampled: the player must scroll to it first.",
  "fully-occluded":
    "Another element covers it at all 9 sample points: an overlay or a layer with a higher z-index.",
  "mostly-occluded": "Another element covers most of its 9 sample points.",
};

const STABILITY_NOTE: Partial<
  Record<ElementSelectorReport["stability"], string>
> = {
  RECOVERED_STABLE:
    "Across states, the stored path still found it, but only after a DES relaxation step: a captured value changed.",
  POSITIONAL_STABLE:
    "Across states, the stored path found it only by checkDirectElement, the weakest step.",
  WRONG_TARGET: "Across states, the stored path landed on a different element.",
  NOT_RESOLVED: "Across states, the stored path found nothing.",
  DETACHED: "Across states, the element disappeared.",
};

function quoted(names: readonly string[]): string {
  return names.map((name) => `\`${name}\``).join(", ");
}

function howFound(report: ElementSelectorReport): string {
  const step = STEPS[report.outcome].step;
  switch (report.outcome) {
    case "DIRECT_SUCCESS":
      return report.winningAttribute
        ? `${step}: \`${report.winningAttribute}\` alone identifies it.`
        : `${step}: the captured path identifies it on the first try.`;
    case "RECOVERED_BY_PARTIAL":
      return `${step}: unique on the stable part of \`${report.winningAttribute ?? "an attribute"}\` only.`;
    case "RECOVERED_BY_IGNORE":
      return report.stableAttributeNames.length > 0
        ? `${step}: no single attribute is unique, so ${quoted(report.stableAttributeNames)} are combined.`
        : `${step}: no single attribute is unique, so several are combined.`;
    case "RECOVERED_BY_CONTEXT":
      return `${step}: its own attributes are not unique; it needs ${report.ancestorDepthUsed} ancestor level(s).`;
    default:
      return `${step}: ${STEPS[report.outcome].meaning}`;
  }
}

function fixFor(report: ElementSelectorReport): string | null {
  switch (report.outcome) {
    case "DIRECT_SUCCESS":
      return null;
    case "RECOVERED_BY_PARTIAL":
      return "Keep the Partial Selector rule for this attribute, or add a stable attribute (a data-* attribute listed first in Attribute Priority).";
    case "RECOVERED_BY_IGNORE":
      return "Give it one unique, stable attribute: an id without digits, a name, or a data-* attribute listed first in Attribute Priority.";
    case "RECOVERED_BY_CONTEXT":
      return "Add a stable attribute to the element, or to its nearest container, so it does not depend on the layout above it.";
    case "POSITIONAL_ONLY":
      return "Give each repeated control an attribute that tells it apart (a data-* attribute or an aria-label).";
    case "AMBIGUOUS":
    case "WRONG_TARGET":
      return "Make it distinguishable from its look-alike with an attribute the look-alike does not share.";
    case "NOT_RESOLVED":
      return "Configure a manual selector for it, or add a stable attribute.";
    case "INACCESSIBLE":
      return "For a cross-origin frame, add its URL to the cross-origin iframe configuration; for shadow DOM, enable shadow root support.";
  }
}

/** One element's evidence, in DES terms. */
export function explainElement(
  report: ElementSelectorReport,
): ElementExplanation {
  const notes: string[] = [];
  if (report.dynamicAttributeNames.length > 0) {
    notes.push(
      `Left out as dynamic (generated or changing values): ${quoted(report.dynamicAttributeNames)}.`,
    );
  }
  if (report.shadowDepth > 0) {
    notes.push(
      `Inside ${report.shadowDepth} shadow root(s): finding it needs shadow root support.`,
    );
  }
  const classification = report.hitTest?.classification;
  if (classification && classification in HIT_TEST_MEANING) {
    notes.push(
      `Hit test: ${HIT_TEST_MEANING[classification as HitTestReasonCount["reason"]]}`,
    );
  } else if (classification === "partially-targetable" && report.hitTest) {
    notes.push(
      `Hit test: reachable at ${report.hitTest.pointsPassed} of 9 sample points; something covers the rest.`,
    );
  }
  const stability = STABILITY_NOTE[report.stability];
  if (stability) notes.push(stability);
  if (!report.hasAccessibleName) {
    notes.push(
      "No accessible name: no label to anchor on or to show users in guidance.",
    );
  }
  return { howFound: howFound(report), notes, fix: fixFor(report) };
}

const STEP_ORDER = Object.keys(STEPS) as SelectorResolutionOutcome[];

/** Counts per DES step, in DES order; steps with no elements are left out. */
export function desSteps(
  counts: Partial<Record<SelectorResolutionOutcome, number>>,
): DesStepCount[] {
  return STEP_ORDER.filter((outcome) => (counts[outcome] ?? 0) > 0).map(
    (outcome) => ({
      outcome,
      step: STEPS[outcome].step,
      elements: counts[outcome] ?? 0,
      meaning: STEPS[outcome].meaning,
    }),
  );
}

/** Counts per hit-test failure reason, most frequent first; reasons with no elements are left out. */
export function hitTestReasons(
  counts: Partial<Record<HitTestReasonCount["reason"], number>>,
): HitTestReasonCount[] {
  return (Object.keys(HIT_TEST_MEANING) as HitTestReasonCount["reason"][])
    .map((reason) => ({
      reason,
      elements: counts[reason] ?? 0,
      meaning: HIT_TEST_MEANING[reason],
    }))
    .filter((row) => row.elements > 0)
    .sort((a, b) => b.elements - a.elements);
}

const MAX_DYNAMIC_ATTRIBUTES = 8;

/** Attribute names left out as dynamic, by how many elements carried each, most frequent first. */
export function dynamicValuesLeftOut(
  reports: readonly Pick<ElementSelectorReport, "dynamicAttributeNames">[],
): DynamicValueCount[] {
  const counts = new Map<string, number>();
  for (const report of reports) {
    for (const name of new Set(report.dynamicAttributeNames)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return mergeDynamicValues([
    [...counts].map(([attribute, elements]) => ({ attribute, elements })),
  ]);
}

/** Several pages' dynamic-value counts summed, most frequent first, capped. */
export function mergeDynamicValues(
  lists: readonly (readonly DynamicValueCount[])[],
): DynamicValueCount[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const { attribute, elements } of list) {
      counts.set(attribute, (counts.get(attribute) ?? 0) + elements);
    }
  }
  return [...counts]
    .map(([attribute, elements]) => ({ attribute, elements }))
    .sort(
      (a, b) =>
        b.elements - a.elements || a.attribute.localeCompare(b.attribute),
    )
    .slice(0, MAX_DYNAMIC_ATTRIBUTES);
}

/** DES evidence for one snapshot: its selector-analysis counts, hit-test counts and element reports. */
export function desEvidenceFor(snapshot: {
  selectorAnalysis: {
    directSuccess: number;
    recoveredByIgnore: number;
    recoveredByPartial: number;
    recoveredByContext: number;
    positionalOnly: number;
    ambiguous: number;
    wrongTarget: number;
    notResolved: number;
    inaccessible: number;
  };
  hitTesting: Partial<
    Record<
      | "hidden"
      | "zeroSize"
      | "outsideViewport"
      | "fullyOccluded"
      | "mostlyOccluded",
      number
    >
  >;
  elementReports: readonly Pick<
    ElementSelectorReport,
    "dynamicAttributeNames"
  >[];
}): DesEvidence {
  const a = snapshot.selectorAnalysis;
  const h = snapshot.hitTesting;
  return {
    steps: desSteps({
      DIRECT_SUCCESS: a.directSuccess,
      RECOVERED_BY_PARTIAL: a.recoveredByPartial,
      RECOVERED_BY_IGNORE: a.recoveredByIgnore,
      RECOVERED_BY_CONTEXT: a.recoveredByContext,
      POSITIONAL_ONLY: a.positionalOnly,
      AMBIGUOUS: a.ambiguous,
      WRONG_TARGET: a.wrongTarget,
      NOT_RESOLVED: a.notResolved,
      INACCESSIBLE: a.inaccessible,
    }),
    dynamicValuesLeftOut: dynamicValuesLeftOut(snapshot.elementReports),
    hitTestReasons: hitTestReasons({
      hidden: h.hidden,
      "zero-size": h.zeroSize,
      "outside-viewport": h.outsideViewport,
      "fully-occluded": h.fullyOccluded,
      "mostly-occluded": h.mostlyOccluded,
    }),
  };
}

/** Several pages' DES evidence summed into one. */
export function mergeDesEvidence(list: readonly DesEvidence[]): DesEvidence {
  const steps: Partial<Record<SelectorResolutionOutcome, number>> = {};
  const reasons: Partial<Record<HitTestReasonCount["reason"], number>> = {};
  for (const evidence of list) {
    for (const row of evidence.steps) {
      steps[row.outcome] = (steps[row.outcome] ?? 0) + row.elements;
    }
    for (const row of evidence.hitTestReasons) {
      reasons[row.reason] = (reasons[row.reason] ?? 0) + row.elements;
    }
  }
  return {
    steps: desSteps(steps),
    dynamicValuesLeftOut: mergeDynamicValues(
      list.map((evidence) => evidence.dynamicValuesLeftOut),
    ),
    hitTestReasons: hitTestReasons(reasons),
  };
}
