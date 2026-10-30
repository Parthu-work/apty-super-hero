/**
 * Check pack for "Apty cannot find the element" and "the tooltip is on the
 * wrong element", from the RAG cards that "start here, an element or
 * selector problem" (JA 1496875202) routes to. It reads the item's stored
 * element from its content file and runs the active selector in every frame
 * of the user's tab the way the 5.x player does: the shadow hosts first,
 * then the first rendered match, else the first match. Every rule is from
 * 5.x code at 4c406d5 or support cases, not runtime-verified, so a finding
 * is never more certain than "likely".
 *
 * The card shows counts, never the selector or the page's text. jQuery and
 * custom-script selectors are code and are not run.
 */
import type { StoredElementTarget } from "@apty/dom-snapshot";
import { isValueDynamic } from "@apty/dom-snapshot";
import type { ElementProbe, FrameProbe } from "../element-probe.js";
import {
  FILE_PROBLEMS,
  fileOf,
  fileParams,
  labelOf,
  looks4x,
  makeGate,
  type Rec,
  records,
  resolveItems,
  short,
  text,
  texts,
} from "./pack-kit.js";
import {
  type Cause,
  type ClientEvidence,
  type ContentKind,
  type DiagnosisResult,
  type GateId,
  type GateReason,
  type GateResult,
  type GateStatus,
  KINDS,
  type NextCheck,
  type NotChecked,
  type Params,
  type RuleId,
  type Verdict,
} from "./types.js";

const SELECTOR_CARD = "1496286045";
const CARD_STEP = "1496351578";
const CARD_DUPLICATE = "1496907796";
const CARD_WRONG_ELEMENT = "1496580223";
const CARD_RELOAD = "1496875045";
const CARD_SHADOW = "1496973357";
const CARD_IFRAME = "1496612922";
const CARD_SCROLL = "1496253303";
const VERIFIED_ON =
  "5.x code, commit 4c406d5, 2026-09-22, and support cases; not runtime-verified";

type ElementKind = Extract<
  ContentKind,
  "tooltip" | "launcher" | "validation" | "workflow"
>;

const ELEMENT_KINDS = new Set<ContentKind>([
  "tooltip",
  "launcher",
  "validation",
  "workflow",
]);

const isElementKind = (kind: ContentKind): kind is ElementKind =>
  ELEMENT_KINDS.has(kind);

/** The selector field each identification type reads (5.x files; the picker's per `docs/development/des-engine.md`). */
const ACTIVE: Record<string, { field: string; language: "css" | "xpath" }> = {
  ELEMENT_PICKER: { field: "pickedSelector", language: "css" },
  CSS: { field: "cssSelector", language: "css" },
  XPATH: { field: "xPath", language: "xpath" },
};

const SELECTOR_FIELDS = [
  "pickedSelector",
  "cssSelector",
  "xPath",
  "jquerySelector",
  "customScript",
];

export type Probe = (target: StoredElementTarget) => Promise<ElementProbe>;

export interface ElementQuery {
  kind: ContentKind;
  query?: string;
  /** The workflow step the message names, 1-based. */
  step?: number;
}

/** Where on the item an element sits: its own, a validation's disabled one, or a workflow step. */
interface Part {
  part: "own" | "disabled" | "step";
  n: number;
  element: unknown;
}

function where(part: Part): string {
  if (part.part === "own") return "Its element";
  if (part.part === "disabled") return `Disabled element ${part.n}`;
  return `Step ${part.n}`;
}

function gate(
  id: GateId,
  status: GateStatus,
  ruleId: RuleId,
  reason: GateReason,
  detail: string,
  params: Params = {},
  evidence: string[] = [],
  cardPageId = SELECTOR_CARD,
): GateResult {
  return makeGate(
    cardPageId,
    id,
    status,
    ruleId,
    reason,
    detail,
    params,
    evidence,
  );
}

/** Names of the files the pack reads for a kind; a workflow's steps come from its own file (`stepFileFor`). */
export function elementFilesFor(kind: ContentKind): string[] {
  return [KINDS[kind].file];
}

/**
 * The file that holds a workflow's steps, as the KB cards name it
 * (`workflow-ID.json`), when the Client has loaded it. Which id the name
 * carries is not verified, so either is accepted.
 */
export function stepFileFor(
  evidence: ClientEvidence,
  query: string | undefined,
): string | undefined {
  if (!query) return undefined;
  const items = records(fileOf(evidence, KINDS.workflow.file).json);
  const [item, ...others] = resolveItems(items, query);
  if (!item || others.length > 0) return undefined;
  const ids = [text(item.sourceId), text(item.id)].filter(
    (id): id is string => id !== undefined,
  );
  return evidence.observedNames.find((name) =>
    ids.some((id) => name === `workflow-${id}.json`),
  );
}

function partsOf(kind: ElementKind, item: Rec, stepFile?: unknown): Part[] {
  if (kind === "workflow") {
    const roots = Array.isArray(stepFile)
      ? records(stepFile)
      : records([stepFile]);
    return roots
      .flatMap((r) => records(r.steps))
      .map((step, i) => ({ part: "step", n: i + 1, element: step.element }));
  }
  const own: Part = { part: "own", n: 1, element: item.element };
  if (kind !== "validation") return [own];
  const disabled = records((item.disableElement as Rec | undefined)?.elements);
  return [
    own,
    ...disabled.map(
      (element, i): Part => ({ part: "disabled", n: i + 1, element }),
    ),
  ];
}

/** Values a selector holds (ids, classes, attribute values), to look for generated ones. */
function valuesIn(selector: string): string[] {
  const quoted = [...selector.matchAll(/(["'])(.*?)\1/g)].map(
    (m) => m[2] ?? "",
  );
  const unquoted = selector.replace(/(["']).*?\1/g, "");
  const named = [...unquoted.matchAll(/[#.]([\w-]+)/g)].map((m) => m[1] ?? "");
  return [...quoted, ...named].filter(Boolean);
}

interface Finding {
  gates: GateResult[];
  causes: Cause[];
  nexts: NextCheck[];
}

function cause(
  ruleId: RuleId,
  cardPageId: string,
  params: Params,
  summary: string,
  fix: string,
  evidence: string[],
): Cause {
  return { ruleId, cardPageId, params, summary, fix, evidence };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** What the probe found where the player looks: the top document, or the frame depth the frame path names. */
function lookupFinding(
  kind: ElementKind,
  part: Part,
  probe: ElementProbe,
  framePath: string[],
  shadowRoots: string[],
  stepNamed: boolean,
): Finding {
  const label = where(part);
  const base = { part: part.part, n: part.n };
  const step = kind === "workflow";
  if (!probe.ok) {
    const reason =
      probe.reason === "no-page" ? "noPageToProbe" : "framesUnreadable";
    return {
      gates: [
        gate(
          "lookup",
          "unknown",
          "SEL-07",
          reason,
          probe.reason === "no-page"
            ? "No web page is open in this tab, so the selector was not run."
            : "The tab's frames could not be listed, so the selector was not run.",
          base,
        ),
      ],
      causes: [],
      nexts: ["openItemPage"],
    };
  }

  const depth = framePath.length;
  const routed = probe.frames.filter((f) => f.depth === depth && f.answered);
  const tests = routed.flatMap((f) => (f.test ? [f.test] : []));
  const elsewhere = probe.frames.filter(
    (f): f is FrameProbe & { test: NonNullable<FrameProbe["test"]> } =>
      f.depth !== depth && f.answered && (f.test?.matchCount ?? 0) > 0,
  );
  const silent = probe.frames.filter((f) => !f.answered).length;
  const matches = sum(tests.map((t) => t.matchCount));
  const rendered = sum(tests.map((t) => t.renderedCount));
  const shadowMatches = sum(tests.map((t) => t.shadowMatches));
  const brokenHost = tests.find((t) => t.brokenHostIndex !== null);
  const scope = depth === 0 ? "the page itself" : `frames at depth ${depth}`;
  const counted = `${label}: ${matches} match(es), ${rendered} rendered, in ${scope}`;
  const fail = (
    ruleId: RuleId,
    reason: GateReason,
    detail: string,
    params: Params,
    card: string,
    fix: string,
    evidence: string[] = [counted],
  ): Finding => ({
    gates: [
      gate("lookup", "fail", ruleId, reason, detail, params, evidence, card),
    ],
    causes: [cause(ruleId, card, params, detail, fix, evidence)],
    nexts: [],
  });

  if (tests.some((t) => t.invalid)) {
    return fail(
      "SEL-04",
      "invalidSelector",
      `${label}: the stored selector does not parse, so the lookup finds nothing.`,
      base,
      SELECTOR_CARD,
      "Select the element again in Studio, or correct the selector, then publish and reload.",
      [`${label}: the selector does not parse`],
    );
  }

  if (matches === 0) {
    if (brokenHost) {
      const index = (brokenHost.brokenHostIndex ?? 0) + 1;
      return fail(
        "SEL-13",
        "brokenShadowHost",
        `${label}: shadow host selector ${index} of ${shadowRoots.length} finds no open shadow root, so the lookup falls back to the document and finds nothing.`,
        { ...base, index, total: shadowRoots.length },
        CARD_SHADOW,
        "Select the element again in Studio so its shadow host chain is recorded, then publish.",
      );
    }
    if (shadowMatches > 0) {
      return fail(
        "SEL-06",
        "shadowScope",
        `${label}: matches ${shadowMatches} element(s) inside a shadow root, but its shadowRootSelectors are empty, so a lookup in the document never reaches them.`,
        { ...base, count: shadowMatches },
        CARD_SHADOW,
        "Select the element again in Studio so the identification includes the shadow host chain, then publish.",
        [
          counted,
          `${label}: ${shadowMatches} match(es) inside open shadow roots`,
        ],
      );
    }
    const first = elsewhere[0];
    if (first) {
      const found = sum(elsewhere.map((f) => f.test.matchCount));
      return depth === 0
        ? fail(
            "SEL-05",
            "frameScope",
            `${label}: matches nothing in the page itself but ${found} element(s) inside a frame, and its frame path (iframesPath) is empty, as a hand-written selector's is.`,
            { ...base, count: found },
            CARD_IFRAME,
            "Delete the hand-written selector and select the element with Studio's picker while inside the frame, so the frame path is recorded; then publish.",
            [
              counted,
              `${label}: ${found} match(es) in a frame at depth ${first.depth}`,
            ],
          )
        : fail(
            "SEL-12",
            "framePathDepth",
            `${label}: its frame path names ${depth} frame level(s), but the element matches at depth ${first.depth}.`,
            { ...base, depth, found: first.depth },
            CARD_SHADOW,
            "Select the element again in Studio inside the frame that holds it, so the frame path matches the live nesting; then publish.",
            [counted, `${label}: ${found} match(es) at depth ${first.depth}`],
          );
    }
    if (silent > 0) {
      return {
        gates: [
          gate(
            "lookup",
            "unknown",
            "SEL-07",
            "framesSilent",
            `${label}: matches nothing in the frames that answered; ${silent} frame(s) did not answer (often a cross-origin frame), so it may be there.`,
            { ...base, silent },
            [counted],
            CARD_SHADOW,
          ),
        ],
        causes: [],
        nexts: ["openItems"],
      };
    }
    if (step && !stepNamed) {
      return {
        gates: [
          gate(
            "lookup",
            "info",
            "SEL-07",
            "noMatchHere",
            `${label}: matches nothing on this page; if the step runs on another page, that is expected.`,
            base,
            [counted],
            CARD_STEP,
          ),
        ],
        causes: [],
        nexts: [],
      };
    }
    return fail(
      "SEL-07",
      "noMatch",
      `${label}: the stored selector matches nothing on this page.`,
      base,
      step ? CARD_STEP : SELECTOR_CARD,
      "Look in Elements for the element nearby: it may have been renamed or moved. Select it again in Studio, then publish and reload.",
    );
  }

  if (matches > 1) {
    const card =
      kind === "tooltip" || kind === "launcher"
        ? CARD_DUPLICATE
        : CARD_WRONG_ELEMENT;
    return fail(
      "SEL-08",
      "severalMatches",
      `${label}: the selector matches ${matches} elements (${rendered} rendered). Apty takes the first rendered one, which may not be yours.`,
      { ...base, count: matches, rendered },
      card,
      "Refine the selector in Studio so it matches only the intended element, then publish and reload.",
    );
  }

  const chosen = tests.find((t) => t.chosen)?.chosen;
  if (chosen && !chosen.rendered) {
    return fail(
      "SEL-09",
      "notRendered",
      `${label}: the selector matches one element, but it is not rendered (hidden by CSS or not displayed), so there is nothing to attach to.`,
      base,
      SELECTOR_CARD,
      "Find out why the element is hidden when the content should show: it may need a click, a tab or a scroll first.",
    );
  }
  if (chosen && !chosen.inViewport) {
    return fail(
      "SEL-10",
      "outOfView",
      `${label}: the selector matches one rendered element, but it is outside the visible part of the page.`,
      base,
      CARD_SCROLL,
      "Scroll the element into view first, or add a scroll before the step as the KB card describes.",
    );
  }
  return {
    gates: [
      gate(
        "lookup",
        "pass",
        "SEL-07",
        "oneMatch",
        `${label}: the selector matches exactly one rendered element in view.`,
        base,
        [counted],
        step ? CARD_STEP : SELECTOR_CARD,
      ),
    ],
    causes: [],
    nexts: [],
  };
}

async function partFinding(
  kind: ElementKind,
  part: Part,
  probe: Probe,
  stepNamed: boolean,
): Promise<Finding> {
  const label = where(part);
  const base = { part: part.part, n: part.n };
  const element = part.element as Rec | null | undefined;
  if (!element || typeof element !== "object") {
    return {
      gates: [
        gate(
          "element",
          "unknown",
          "SEL-01",
          "noElement",
          `${label} has no element in the file; this is probably a publish defect (not verified).`,
          base,
          [`${label}: element = null`],
        ),
      ],
      causes: [],
      nexts: ["sendSupport"],
    };
  }
  const type = text(element.identificationType) ?? "(none)";
  const active = ACTIVE[type];
  if (!active) {
    return {
      gates: [
        gate(
          "element",
          "unknown",
          "SEL-03",
          "codeSelector",
          `${label} is identified by ${type}, which is code the check does not run.`,
          { ...base, type },
          [`${label}: identificationType = ${type}`],
        ),
      ],
      causes: [],
      nexts: ["runInConsole"],
    };
  }
  const selector = text(element[active.field]);
  if (!selector) {
    const filled = SELECTOR_FIELDS.filter(
      (f) => f !== active.field && text(element[f]),
    );
    const detail = `${label} is identified by ${type}, but its ${active.field} is empty${filled.length ? `; the filled ${filled.join(", ")} ${filled.length > 1 ? "are" : "is"} ignored` : ""}.`;
    const evidence = [
      `${label}: identificationType = ${type}, ${active.field} empty`,
    ];
    const params = { ...base, type, field: active.field };
    return {
      gates: [
        gate(
          "element",
          "fail",
          "SEL-02",
          "activeFieldEmpty",
          detail,
          params,
          evidence,
        ),
      ],
      causes: [
        cause(
          "SEL-02",
          SELECTOR_CARD,
          params,
          detail,
          "In Studio, select the element again, or fill the selector of the active identification type, then publish.",
          evidence,
        ),
      ],
      nexts: [],
    };
  }

  const framePath = texts(element.iframesPath);
  const shadowRoots = texts(element.shadowRootSelectors);
  const found = lookupFinding(
    kind,
    part,
    await probe({ language: active.language, selector, shadowRoots }),
    framePath,
    shadowRoots,
    stepNamed,
  );
  const generated = valuesIn(selector).filter(isValueDynamic).length;
  const noMatch = found.gates.some(
    (g) => g.reason === "noMatch" || g.reason === "noMatchHere",
  );
  const elementGate = gate(
    "element",
    "info",
    "SEL-00",
    "elementRead",
    `${label} is identified by ${type}; frame path ${framePath.length} level(s), shadow hosts ${shadowRoots.length}.`,
    { ...base, type, frames: framePath.length, hosts: shadowRoots.length },
    [`${label}: identificationType = ${type}`],
  );
  if (generated === 0)
    return { ...found, gates: [elementGate, ...found.gates] };

  const detail = `${label}: the selector holds ${generated} generated-looking value(s) (3 or more digits in a row, or mostly digits), which often change after a reload.`;
  const params = { ...base, count: generated };
  const evidence = [
    `${label}: ${generated} generated-looking value(s) in the selector`,
  ];
  if (noMatch && found.causes.length > 0) {
    return {
      gates: [
        elementGate,
        ...found.gates,
        gate(
          "selector-values",
          "fail",
          "SEL-11",
          "dynamicValue",
          detail,
          params,
          evidence,
          CARD_RELOAD,
        ),
      ],
      causes: [
        cause(
          "SEL-11",
          CARD_RELOAD,
          params,
          detail,
          "In Admin > Application > DOM Analysis, add an ignore rule for the attribute that changes, select the element again in Studio and publish.",
          evidence,
        ),
        ...found.causes,
      ],
      nexts: found.nexts,
    };
  }
  return {
    gates: [
      elementGate,
      ...found.gates,
      gate(
        "selector-values",
        "unknown",
        "SEL-11",
        "dynamicValue",
        detail,
        params,
        evidence,
        CARD_RELOAD,
      ),
    ],
    causes: found.causes,
    nexts: [...found.nexts, "reloadAndRetest"],
  };
}

function finish(
  q: ElementQuery,
  evidence: ClientEvidence,
  gates: GateResult[],
  verdict: Verdict,
  extra: { name?: string; matched?: string[]; notChecked?: NotChecked[] } = {},
): DiagnosisResult {
  return {
    packId: "element-not-found",
    cardPageId: SELECTOR_CARD,
    verifiedOn: VERIFIED_ON,
    subject: {
      kind: q.kind,
      ...(q.query ? { query: q.query } : {}),
      ...(extra.name ? { name: extra.name } : {}),
      matched: extra.matched ?? [],
    },
    gates,
    verdict,
    confidence:
      verdict.status === "no_data" || verdict.status === "out_of_scope"
        ? "unknown"
        : "likely",
    files: Object.values(evidence.files).map((f) => ({
      name: f.name,
      status: f.status,
      ...(f.httpStatus !== undefined ? { httpStatus: f.httpStatus } : {}),
    })),
    notChecked: extra.notChecked ?? [],
  };
}

function stopAt(
  q: ElementQuery,
  evidence: ClientEvidence,
  data: GateResult,
  status: Verdict["status"],
  nextCheck: NextCheck,
  gates: GateResult[] = [],
  extra: Parameters<typeof finish>[4] = {},
): DiagnosisResult {
  return finish(
    q,
    evidence,
    [...gates, data],
    { status, headline: data.detail, causes: [], nextCheck },
    extra,
  );
}

/** Runs the pack: the item's stored elements from its file, each run in the tab's frames through `probe`. */
export async function diagnoseElementNotFound(
  evidence: ClientEvidence,
  q: ElementQuery,
  probe: Probe,
): Promise<DiagnosisResult> {
  if (!evidence.connection.ok) {
    const { message } = evidence.connection;
    return stopAt(
      q,
      evidence,
      gate(
        "data",
        "fail",
        "SEL-00",
        "clientUnreachable",
        `Could not reach the Apty Client: ${message}`,
        { message },
      ),
      "no_data",
      "fixConnection",
    );
  }
  if (looks4x(evidence)) {
    return stopAt(
      q,
      evidence,
      gate(
        "version",
        "fail",
        "SEL-00",
        "version4x",
        "This tenant uses 4.x content files (flow.json, segments.json). The checks are verified for 5.x only.",
      ),
      "out_of_scope",
      "manual4x",
    );
  }
  if (!isElementKind(q.kind)) {
    return stopAt(
      q,
      evidence,
      gate(
        "element",
        "info",
        "SEL-00",
        "kindHasNoElement",
        `A ${KINDS[q.kind].label} is not attached to an element, so there is no selector to check.`,
        { kind: q.kind },
      ),
      "out_of_scope",
      "nameItem",
    );
  }
  const kind = q.kind;
  const spec = KINDS[kind];
  const kindFile = fileOf(evidence, spec.file);
  if (kindFile.status !== "ok") {
    const problem = FILE_PROBLEMS[kindFile.status];
    return stopAt(
      q,
      evidence,
      gate(
        "data",
        "fail",
        "SEL-00",
        problem.reason,
        problem.text(kindFile),
        fileParams(kindFile),
      ),
      "no_data",
      problem.nextCheck,
    );
  }
  const items = records(kindFile.json);
  const read = gate(
    "data",
    "pass",
    "SEL-00",
    "filesRead",
    `${spec.file} read (${items.length} entries).`,
    { file: spec.file, count: items.length },
    [`${spec.file}: ok`],
  );
  if (!q.query) {
    return stopAt(
      q,
      evidence,
      gate(
        "published",
        "unknown",
        "SEL-00",
        "itemNotNamed",
        `Name the ${spec.label} whose element is not found.`,
        { kind },
      ),
      "candidates",
      "nameItem",
      [read],
    );
  }
  const matches = resolveItems(items, q.query);
  const item = matches[0];
  if (!item) {
    return stopAt(
      q,
      evidence,
      gate(
        "published",
        "fail",
        "SEL-00",
        "notPublished",
        `No ${spec.label} named "${q.query}" is in ${spec.file}, so it is not published to this environment and the selector is not the cause.`,
        { query: q.query, file: spec.file },
      ),
      "no_data",
      "whichOne",
      [read],
    );
  }
  if (matches.length > 1) {
    const names = matches.map(
      (m) => `${labelOf(m)} (${short(text(m.sourceId) ?? "")})`,
    );
    return stopAt(
      q,
      evidence,
      gate(
        "published",
        "unknown",
        "SEL-00",
        "severalMatch",
        `${matches.length} ${spec.label}s match "${q.query}".`,
        { count: matches.length, name: q.query },
        names,
      ),
      "candidates",
      "whichOne",
      [read],
      { matched: names },
    );
  }

  const name = labelOf(item);
  const gates: GateResult[] = [read];
  let stepFile: unknown;
  if (kind === "workflow") {
    const fileName = stepFileFor(evidence, q.query);
    const file = fileName ? fileOf(evidence, fileName) : undefined;
    if (!file || file.status !== "ok") {
      return stopAt(
        q,
        evidence,
        gate(
          "element",
          "unknown",
          "SEL-00",
          "stepFileMissing",
          `The steps of "${name}" are in its own file (workflow-ID.json), which the Apty Client has not loaded${file ? ` (${file.status})` : ""}.`,
          { name, ...(file ? { status: file.status } : {}) },
        ),
        "candidates",
        "playWorkflow",
        gates,
        { name },
      );
    }
    stepFile = file.json;
    gates.push(
      gate(
        "data",
        "pass",
        "SEL-00",
        "filesRead",
        `${file.name} read.`,
        { file: file.name, count: 1 },
        [`${file.name}: ok`],
      ),
    );
  }

  const parts = partsOf(kind, item, stepFile);
  const chosen = q.step ? parts.filter((p) => p.n === q.step) : parts;
  if (chosen.length === 0) {
    return stopAt(
      q,
      evidence,
      gate(
        "element",
        "fail",
        "SEL-00",
        "stepNotFound",
        `"${name}" has ${parts.length} step(s) in its file, so there is no step ${q.step}.`,
        { name, count: parts.length, step: q.step ?? 0 },
      ),
      "no_data",
      "whichOne",
      gates,
      { name },
    );
  }

  const findings: Finding[] = [];
  for (const part of chosen) {
    findings.push(await partFinding(kind, part, probe, q.step !== undefined));
  }
  gates.push(...findings.flatMap((f) => f.gates));
  const causes = findings.flatMap((f) => f.causes);
  const nexts = findings.flatMap((f) => f.nexts);
  const open = gates.some((g) => g.status === "unknown");
  const elsewhere = gates.filter((g) => g.reason === "noMatchHere").length;
  const verdict: Verdict =
    causes.length === 0 && elsewhere > 0
      ? {
          status: "candidates",
          headline: `${elsewhere} of ${chosen.length} steps of "${name}" match nothing on this page. Name the step that fails, on the page where it fails.`,
          causes: [],
          nextCheck: "nameStep",
        }
      : causes.length > 0
        ? {
            status: "cause_found",
            headline: causes[0]?.summary ?? "",
            causes,
            ...(open ? { nextCheck: "openItems" as const } : {}),
          }
        : open
          ? {
              status: "candidates",
              headline: `Nothing in the stored element${chosen.length > 1 ? "s" : ""} of "${name}" decides it; see the open checks.`,
              causes: [],
              nextCheck: nexts[0] ?? "openItems",
            }
          : {
              status: "no_cause_in_data",
              headline: `The stored selector${chosen.length > 1 ? "s" : ""} of "${name}" find${chosen.length > 1 ? "" : "s"} exactly one rendered element on this page.`,
              causes: [],
              nextCheck: "checkTiming",
            };
  return finish(q, evidence, gates, verdict, {
    name,
    matched: [name],
    notChecked: ["element-timing", "closed-shadow-roots"],
  });
}
