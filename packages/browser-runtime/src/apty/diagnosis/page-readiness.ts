/**
 * Check pack for "Apty cannot select elements on this page", from the same
 * RAG cards as the selector check, read off the DOM Health audit of the
 * page in the user's tab: frames it could not inspect or tell apart,
 * shadow roots, virtualized lists, covered elements, shared ids and how
 * many elements no automatic selector resolves. Each finding is one of
 * DOM Health's own risks with its own thresholds; this pack only names the
 * KB card for it. Never more certain than "likely".
 */
import type { DomHealthAuditOutcome } from "../dom-health.js";
import type { DomHealthAuditResult } from "../dom-health-scoring.js";
import { makeGate } from "./pack-kit.js";
import type {
  Cause,
  DiagnosisResult,
  GateId,
  GateReason,
  GateResult,
  GateStatus,
  Params,
  RuleId,
  Verdict,
} from "./types.js";

const PAGE_CARD = "1496875202";
const CARD_SELECTOR = "1496286045";
const CARD_FRAMES = "1496973375";
const CARD_FRAME_SELECTORS = "1496286117";
const CARD_SHADOW = "1496973357";
const CARD_VIRTUALIZED = "1496678537";
const CARD_COVERED = "1496351596";
const CARD_WRONG_ELEMENT = "1496580223";
const VERIFIED_ON =
  "DOM Health's audit of this page, read against the 5.x KB cards (5.x code, commit 4c406d5); not runtime-verified";

const FRAMES_NOT_INSPECTED = new Set([
  "evidence-partial",
  "evidence-inaccessible",
  "application-frame-not-inspected",
]);
const UNRESOLVED = new Set([
  "low-automatic-selection",
  "manual-selector-dependency",
  "ambiguous-or-wrong-target",
]);

interface Finding {
  gate: GateResult;
  cause?: Cause;
}

function finding(
  id: GateId,
  ruleId: RuleId,
  cardPageId: string,
  found: boolean,
  reasons: [GateReason, GateReason],
  detail: [string, string],
  params: Params,
  fix: string,
  evidence: string[],
): Finding {
  const [yes, no] = reasons;
  const status: GateStatus = found ? "fail" : "pass";
  const text = found ? detail[0] : detail[1];
  return {
    gate: makeGate(
      cardPageId,
      id,
      status,
      ruleId,
      found ? yes : no,
      text,
      params,
      found ? evidence : [],
    ),
    ...(found
      ? {
          cause: {
            ruleId,
            cardPageId,
            params,
            summary: text,
            fix,
            evidence,
          },
        }
      : {}),
  };
}

function findings(audit: DomHealthAuditResult): Finding[] {
  const risk = (id: string) => audit.risks.some((r) => r.id === id);
  const { frameAccessibility: fa } = audit;
  const notInspected = fa.framesTotal - fa.framesAccessible;
  const unresolved = audit.risks.some((r) => UNRESOLVED.has(r.id));
  const frameSelectors = audit.iframes.selectors;
  return [
    finding(
      "frames",
      "DOM-01",
      CARD_FRAMES,
      audit.risks.some((r) => FRAMES_NOT_INSPECTED.has(r.id)),
      ["framesNotInspected", "framesInspected"],
      [
        `${notInspected} of ${fa.framesTotal} frame(s) could not be inspected (often a cross-origin frame), so Apty's selection there was not checked.`,
        `Every frame that answered was inspected (${fa.framesAccessible} of ${fa.framesTotal}).`,
      ],
      { count: notInspected, total: fa.framesTotal },
      "Make sure the frame that holds the element is registered for Apty, and select the element inside that frame in Studio.",
      [`frames: ${fa.framesAccessible} of ${fa.framesTotal} inspected`],
    ),
    ...(risk("frame-selectors") && frameSelectors
      ? [
          finding(
            "frames",
            "DOM-07",
            CARD_FRAME_SELECTORS,
            true,
            ["frameSelectors", "framesInspected"],
            [
              `${frameSelectors.positional + frameSelectors.onSrc} of ${frameSelectors.analyzed} frame(s) can only be told apart by position or by their address, so a stored frame path can point at another frame.`,
              "",
            ],
            {
              count: frameSelectors.positional + frameSelectors.onSrc,
              total: frameSelectors.analyzed,
            },
            "Give each frame a stable id or name, or add a Partial Selector rule for its address, then select the element again.",
            [
              `frame selectors: ${frameSelectors.positional} by position, ${frameSelectors.onSrc} by address`,
            ],
          ),
        ]
      : []),
    finding(
      "virtualized",
      "DOM-03",
      CARD_VIRTUALIZED,
      audit.virtualized.containers > 0,
      ["virtualizedLists", "noVirtualizedLists"],
      [
        `${audit.virtualized.containers} list(s) draw only the rows in view (${audit.virtualized.observedItems} drawn now), so a target further down is not in the page until it is scrolled to.`,
        "No virtualized list was found.",
      ],
      {
        count: audit.virtualized.containers,
        drawn: audit.virtualized.observedItems,
      },
      "Scroll the row into view before the step, as the KB card describes; a selector cannot find a row that is not drawn.",
      [
        `virtualized lists: ${audit.virtualized.containers}, rows drawn: ${audit.virtualized.observedItems}`,
      ],
    ),
    finding(
      "overlays",
      "DOM-04",
      CARD_COVERED,
      risk("hit-test-failures"),
      ["coveredElements", "noCoveredElements"],
      [
        `Some interactive elements are covered, zero-sized or outside the view at the points a click would use; ${audit.zIndex.highZIndexElementCount} element(s) sit at a very high z-index.`,
        "The interactive elements tested can be reached by a click.",
      ],
      { overlays: audit.zIndex.highZIndexElementCount },
      "Find what covers the element (a sticky header, a dialog, a chat launcher) and test with it closed; Apty's content can be hidden behind it too.",
      [
        `elements at a very high z-index: ${audit.zIndex.highZIndexElementCount}`,
      ],
    ),
    finding(
      "duplicate-ids",
      "DOM-05",
      CARD_WRONG_ELEMENT,
      risk("duplicate-ids"),
      ["duplicateIds", "noDuplicateIds"],
      [
        `${audit.duplicateIds.elementsWithDuplicatedId} element(s) share their id with another in the same document or shadow root, so a selector on that id matches more than one.`,
        "Every id is unique in its document or shadow root.",
      ],
      { count: audit.duplicateIds.elementsWithDuplicatedId },
      "Do not select these elements by id: refine the selector in Studio with another attribute, then publish.",
      [
        `elements with a shared id: ${audit.duplicateIds.elementsWithDuplicatedId}`,
      ],
    ),
    finding(
      "automatic-selection",
      "DOM-06",
      CARD_SELECTOR,
      unresolved,
      ["manualSelectors", "automaticSelectors"],
      [
        `${audit.manualSelectorDependency}% of the interactive elements analyzed have no unique, stable selector by Apty's own rules and would need a hand-made one.`,
        "Apty's own rules give most interactive elements a unique, stable selector.",
      ],
      { percent: audit.manualSelectorDependency },
      "For the elements your content uses, check the selector Studio recorded and make it stable (Ignore and Partial Selector rules, or XPath), then publish.",
      [
        `elements needing a hand-made selector: ${audit.manualSelectorDependency}% of ${audit.metadata.interactiveElementsAnalyzed}`,
      ],
    ),
  ];
}

function finish(gates: GateResult[], verdict: Verdict): DiagnosisResult {
  return {
    packId: "page-readiness",
    cardPageId: PAGE_CARD,
    verifiedOn: VERIFIED_ON,
    subject: { kind: "page", matched: [] },
    gates,
    verdict,
    confidence: verdict.status === "no_data" ? "unknown" : "likely",
    files: [],
    notChecked:
      verdict.status === "no_data" ? [] : ["canvas", "closed-shadow-roots"],
  };
}

/** Reads the DOM Health audit of the page in the tab; undefined when no web page is open there. */
export function diagnosePageReadiness(
  audit: DomHealthAuditOutcome | undefined,
): DiagnosisResult {
  if (!audit?.available) {
    const message =
      audit?.error ?? "No web page is open in this tab, so it was not audited.";
    const data = makeGate(
      PAGE_CARD,
      "data",
      "fail",
      "DOM-00",
      "auditUnavailable",
      message,
      { message },
    );
    return finish([data], {
      status: "no_data",
      headline: message,
      causes: [],
      nextCheck: "openItemPage",
    });
  }
  if (audit.evidenceState === "FAILED") {
    const message = "No frame of this page answered, so nothing was audited.";
    return finish(
      [
        makeGate(
          PAGE_CARD,
          "data",
          "fail",
          "DOM-00",
          "auditUnavailable",
          message,
          { message },
        ),
      ],
      { status: "no_data", headline: message, causes: [], nextCheck: "reload" },
    );
  }

  const score = makeGate(
    PAGE_CARD,
    "data",
    "info",
    "DOM-00",
    "auditScore",
    `DOM Health scored this page ${audit.score ?? "n/a"} (${audit.grade}, ${audit.confidence} confidence) over ${audit.metadata.interactiveElementsAnalyzed} interactive elements.`,
    {
      score: audit.score ?? "n/a",
      grade: audit.grade,
      elements: audit.metadata.interactiveElementsAnalyzed,
    },
  );
  const shadow = makeGate(
    CARD_SHADOW,
    "shadow-dom",
    "info",
    "DOM-02",
    audit.shadowDom.roots > 0 ? "shadowRoots" : "noShadowRoots",
    audit.shadowDom.roots > 0
      ? `${audit.shadowDom.roots} open shadow root(s) hold ${audit.shadowDom.elements} element(s); a selector reaches them only with the shadow host chain Studio's picker records.`
      : "No open shadow root was found.",
    { count: audit.shadowDom.roots, elements: audit.shadowDom.elements },
  );
  const found = findings(audit);
  const causes = found.flatMap((f) => (f.cause ? [f.cause] : []));
  const gates = [score, ...found.map((f) => f.gate), shadow];
  return finish(
    gates,
    causes.length > 0
      ? {
          status: "candidates",
          headline: `${causes.length} finding(s) on this page can stop Apty from finding an element. To check one item's own selector, name it ("the Save tooltip is on the wrong element").`,
          causes,
          nextCheck: "nameItem",
        }
      : {
          status: "no_cause_in_data",
          headline:
            "DOM Health found nothing on this page that stops Apty's element selection.",
          causes: [],
          nextCheck: "nameItem",
        },
  );
}
