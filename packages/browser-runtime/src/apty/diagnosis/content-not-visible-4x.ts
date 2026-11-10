/**
 * Check pack for "my flow is not showing" on a 4.x tenant (KB-RAG K14,
 * D-KB7), checked against apty-assist `player3.0` at the commit in
 * `FOUR_X_VERIFIED_ON` (K21 F4); paths below are under `player3.0/src/`.
 * With the `publishingSystem` flag on, flow.json lists the environment's
 * flows (a `name` per locale, `hideInWidget`, an optional `attachedRule`)
 * and `flow-<id>.json` is a flow's steps, a bare array. segments.json's
 * segments hold `conditions`, decided in the browser, and the `flows` each
 * lists; rules.json holds the rules flows attach. Not runtime-verified.
 * Only workflows (flows) are ported; another kind keeps the version gate.
 */
import { CARD_4X, card4x } from "./cards-4x.js";
import {
  FILE_PROBLEMS,
  fileOf,
  fileParams,
  jsonOf,
  makeGate,
  type Rec,
  records,
  short,
  text,
} from "./pack-kit.js";
import type {
  Cause,
  ClientEvidence,
  ContentKind,
  DiagnosisResult,
  GateId,
  GateReason,
  GateResult,
  GateStatus,
  NextCheck,
  Params,
  RuleId,
  Verdict,
} from "./types.js";
import {
  FOUR_X_CONFIDENCE,
  FOUR_X_VERIFIED_ON,
  flagOn,
} from "./widget-not-visible-4x.js";

export const CONTENT_FILES_4X = [
  "flow.json",
  "segments.json",
  "rules.json",
  "feature-flag.json",
];

/** The steps file the 4.x player loads for one flow. */
export const flowStepsFile = (id: string) => `flow-${id}.json`;

const gate = (
  id: GateId,
  status: GateStatus,
  ruleId: RuleId,
  reason: GateReason,
  detail: string,
  params: Params = {},
  evidence: string[] = [],
): GateResult =>
  makeGate(
    card4x(ruleId),
    id,
    status,
    ruleId,
    reason,
    detail,
    params,
    evidence,
  );

/** A flow's names: `name` as a string, or one per locale in an object. */
export function flowNames(flow: Rec): string[] {
  const name = flow.name;
  if (typeof name === "string") return name.trim() ? [name] : [];
  if (name && typeof name === "object") {
    return Object.values(name as Rec).flatMap((value) =>
      typeof value === "string" && value.trim() ? [value] : [],
    );
  }
  return [];
}

function resolveFlows(flows: Rec[], query: string): Rec[] {
  const wanted = query.trim().toLowerCase();
  const byId = flows.filter((flow) => String(flow.id) === query.trim());
  if (byId.length > 0) return byId;
  const exact = flows.filter((flow) =>
    flowNames(flow).some((n) => n.trim().toLowerCase() === wanted),
  );
  if (exact.length > 0) return exact;
  return flows.filter((flow) =>
    flowNames(flow).some((n) => n.toLowerCase().includes(wanted)),
  );
}

interface Draft {
  evidence: ClientEvidence;
  kind: ContentKind;
  query?: string;
}

function finish(
  draft: Draft,
  gates: GateResult[],
  verdict: Verdict,
  name?: string,
): DiagnosisResult {
  return {
    packId: "content-not-visible",
    cardPageId: CARD_4X["C4X-02"],
    verifiedOn: FOUR_X_VERIFIED_ON,
    aptyVersion: "4.x",
    subject: {
      kind: draft.kind,
      ...(draft.query ? { query: draft.query } : {}),
      ...(name ? { name } : {}),
      matched: name ? [name] : [],
    },
    gates,
    verdict,
    confidence:
      verdict.status === "cause_found" ? FOUR_X_CONFIDENCE : "unknown",
    files: CONTENT_FILES_4X.map((file) => {
      const loaded = fileOf(draft.evidence, file);
      return {
        name: file,
        status: loaded.status,
        ...(loaded.httpStatus !== undefined
          ? { httpStatus: loaded.httpStatus }
          : {}),
      };
    }),
    notChecked:
      verdict.status === "no_data" || verdict.status === "out_of_scope"
        ? []
        : ["membership", "runtime-rules", "player-filters-4x"],
  };
}

const found = (
  draft: Draft,
  gates: GateResult[],
  cause: Cause,
  name?: string,
  nextCheck?: NextCheck,
) =>
  finish(
    draft,
    [
      ...gates,
      gate(
        "published",
        "fail",
        cause.ruleId,
        REASON[cause.ruleId] ?? "notPublished",
        cause.summary,
        cause.params,
        cause.evidence,
      ),
    ],
    {
      status: "cause_found",
      headline: cause.summary,
      causes: [cause],
      ...(nextCheck ? { nextCheck } : {}),
    },
    name,
  );

const REASON: Partial<Record<RuleId, GateReason>> = {
  "C4X-01": "emptyList",
  "C4X-02": "notPublished",
  "C4X-03": "flowHidden4x",
  "C4X-06": "flowSteps4x",
};

const causeOf = (
  ruleId: RuleId,
  summary: string,
  fix: string,
  params: Params,
  evidence: string[],
): Cause => ({
  ruleId,
  cardPageId: card4x(ruleId),
  params,
  summary,
  fix,
  evidence,
});

export function diagnoseContentNotVisible4x(
  evidence: ClientEvidence,
  kind: ContentKind,
  query?: string,
): DiagnosisResult {
  const draft: Draft = { evidence, kind, query: query?.trim() || undefined };
  if (kind !== "workflow") {
    const version = gate(
      "version",
      "fail",
      "CNV-V5",
      "version4x",
      `This tenant uses 4.x content files. The 4.x checks cover flows (workflows) and the widget so far, not a ${kind}.`,
    );
    return finish(draft, [version], {
      status: "out_of_scope",
      headline: version.detail,
      causes: [],
      nextCheck: "manual4x",
    });
  }

  const flowFile = fileOf(evidence, "flow.json");
  const flags = fileOf(evidence, "feature-flag.json");
  if (
    flowFile.status === "not_observed" &&
    flags.status === "ok" &&
    !flagOn(flags.json, "publishingSystem")
  ) {
    // cdn-helpers.ts, feature-flag.types.ts:100-103: without publishingSystem
    // the flows and their steps come from the Assist server, not flow.json.
    const server = gate(
      "data",
      "info",
      "C4X-00",
      "flowsFromServer4x",
      "This tenant's publishing flag is off, so the 4.x player reads its flows from the Assist server, not from flow.json; the files cannot show them.",
    );
    return finish(draft, [server], {
      status: "out_of_scope",
      headline: server.detail,
      causes: [],
      nextCheck: "manual4x",
    });
  }
  if (flowFile.status === "empty") {
    return found(
      draft,
      [],
      causeOf(
        "C4X-01",
        "flow.json is an empty list: no flow is published in this environment.",
        "In 4.x Studio, publish the flow to this environment, then reload.",
        { httpStatus: flowFile.httpStatus ?? 0 },
        [`flow.json: [] (HTTP ${flowFile.httpStatus})`],
      ),
      undefined,
      "readStatus",
    );
  }
  if (flowFile.status !== "ok") {
    const problem = FILE_PROBLEMS[flowFile.status];
    const data = gate(
      "data",
      "fail",
      "C4X-00",
      problem.reason,
      problem.text(flowFile),
      fileParams(flowFile),
    );
    return finish(draft, [data], {
      status: "no_data",
      headline: data.detail,
      causes: [],
      nextCheck: problem.nextCheck,
    });
  }

  const flows = records(flowFile.json);
  const gates: GateResult[] = [
    gate(
      "data",
      "pass",
      "C4X-00",
      "filesRead",
      `flow.json read (${flows.length} flow(s)).`,
      { file: "flow.json", count: flows.length },
    ),
  ];
  if (!draft.query) {
    return finish(draft, gates, {
      status: "candidates",
      headline: "Name the flow that is missing to check it.",
      causes: [],
      nextCheck: "nameItem",
    });
  }
  const matches = resolveFlows(flows, draft.query);
  if (matches.length === 0) {
    return found(
      draft,
      gates,
      causeOf(
        "C4X-02",
        `No flow named "${draft.query}" is in flow.json: it is not published in this environment.`,
        "In 4.x Studio, publish the flow to this environment (check its name), then reload.",
        { file: "flow.json", name: draft.query },
        [`flow.json: ${flows.length} flow(s), none named "${draft.query}"`],
      ),
    );
  }
  if (matches.length > 1) {
    return finish(
      draft,
      [
        ...gates,
        gate(
          "published",
          "unknown",
          "C4X-02",
          "severalMatch",
          `${matches.length} flows match "${draft.query}".`,
          { count: matches.length, name: draft.query },
        ),
      ],
      {
        status: "candidates",
        headline: `${matches.length} flows match "${draft.query}".`,
        causes: [],
        nextCheck: "whichOne",
      },
    );
  }
  const flow = matches[0] as Rec;
  const id = String(flow.id);
  const name = flowNames(flow)[0] ?? short(id);
  gates.push(
    gate("published", "pass", "C4X-02", "found", `"${name}" is in flow.json.`, {
      name,
      file: "flow.json",
    }),
  );
  const locales = nameLocales(flow);
  if (locales.length > 0) {
    // tool-list.selectors.ts:33-38: the widget lists the flow only under the
    // user's locale id, with no fallback to another locale.
    gates.push(
      gate(
        "published",
        "info",
        "C4X-02",
        "flowLocales4x",
        `"${name}" is listed only for users whose language is one of locale ${locales.join(", ")}.`,
        { name, locales: locales.join(", ") },
      ),
    );
  }

  // tool-list.component.tsx:114-124: any truthy hideInWidget hides it.
  if (flow.hideInWidget) {
    return found(
      draft,
      gates,
      causeOf(
        "C4X-03",
        `"${name}" is hidden from the widget (flow.json hideInWidget).`,
        "In 4.x Studio, clear the flow's hide-in-widget option, publish and reload.",
        { name },
        [`flow.json: hideInWidget = ${String(flow.hideInWidget)}`],
      ),
      name,
    );
  }

  gates.push(segmentGate(evidence, id, name));
  const ruleGate = attachedRuleGate(evidence, flow, name);
  if (ruleGate) gates.push(ruleGate);

  const stepsFile = fileOf(evidence, flowStepsFile(id));
  let next: NextCheck | undefined;
  if (stepsFile.status === "ok" || stepsFile.status === "empty") {
    // flows.effects.ts:158-186, 282-285: a bare array of steps; an empty one
    // plays nothing, and anything else fails to load (loadStepsFailed).
    const steps = stepsFile.json;
    if (!Array.isArray(steps)) {
      return found(
        draft,
        gates,
        causeOf(
          "C4X-06",
          `${flowStepsFile(id)} is not a list of steps, so the 4.x player fails to load "${name}".`,
          "In 4.x Studio, publish the flow again so its steps file is rebuilt, then reload.",
          { name, file: flowStepsFile(id), variant: "notList" },
          [`${flowStepsFile(id)}: not a list`],
        ),
        name,
      );
    }
    if (steps.length === 0) {
      return found(
        draft,
        gates,
        causeOf(
          "C4X-06",
          `${flowStepsFile(id)} has no steps for "${name}", so it has nothing to play.`,
          "In 4.x Studio, check the flow's steps, publish and reload.",
          { name, file: flowStepsFile(id) },
          [`${flowStepsFile(id)}: 0 steps`],
        ),
        name,
      );
    }
  } else {
    gates.push(
      gate(
        "published",
        "unknown",
        "C4X-06",
        "flowStepsUnread4x",
        `${flowStepsFile(id)} was not read: the player loads it when the flow plays.`,
        { name, file: flowStepsFile(id) },
      ),
    );
    next = "playWorkflow";
  }

  return finish(
    draft,
    gates,
    {
      status: "candidates",
      headline: `No blocker for "${name}" in the 4.x files. What is left is decided in the browser.`,
      causes: [],
      nextCheck: next ?? "testAsMember",
    },
    name,
  );
}

/** The locale ids a flow has a name under, when `name` is per locale. */
function nameLocales(flow: Rec): string[] {
  const name = flow.name;
  if (!name || typeof name !== "object") return [];
  return Object.entries(name as Rec)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([locale]) => locale);
}

/**
 * Who gets the flow (`segments.selectors.ts:55-70`): a user who matches
 * any segment gets only the flows those segments list; a user who matches
 * none gets every flow. A segment's `conditions` are decided in the
 * browser, so this stays open unless there is no segment at all.
 */
function segmentGate(
  evidence: ClientEvidence,
  id: string,
  name: string,
): GateResult {
  const all = records(jsonOf(evidence, "segments.json"));
  if (all.length === 0) {
    return gate(
      "segments",
      "pass",
      "C4X-04",
      "noSegments",
      `No segment is defined, so every user can get "${name}".`,
      { name },
    );
  }
  const listing = all.filter((s) =>
    (Array.isArray(s.flows) ? s.flows : []).some((f) => String(f) === id),
  );
  const names = listing.map((s) => text(s.name) ?? String(s.id)).join(", ");
  return listing.length === 0
    ? gate(
        "segments",
        "unknown",
        "C4X-04",
        "flowInNoSegment4x",
        `No segment lists "${name}", so only users who match no segment get it; whether this user matches one is decided in the browser.`,
        { name },
      )
    : gate(
        "segments",
        "unknown",
        "C4X-04",
        "flowSegments4x",
        `"${name}" is for users of ${names}, and for users who match no segment; whether this user does is decided in the browser.`,
        { name, segments: names },
      );
}

/**
 * A flow's own rule (`rule-engine.helpers.ts:46-61`): `attachedRule.id`
 * names a rule in rules.json, run in the browser to show or hide the flow.
 * A rule rules.json does not hold never runs, so the flow stays visible.
 */
function attachedRuleGate(
  evidence: ClientEvidence,
  flow: Rec,
  name: string,
): GateResult | undefined {
  const attached = flow.attachedRule as Rec | undefined;
  if (attached?.id == null) return undefined;
  const ruleId = String(attached.id);
  const rulesFile = fileOf(evidence, "rules.json");
  const rule =
    rulesFile.status === "ok"
      ? records(rulesFile.json).find((r) => String(r.id) === ruleId)
      : undefined;
  if (rulesFile.status === "ok" && !rule) {
    return gate(
      "segments",
      "pass",
      "C4X-05",
      "ruleNotInRules4x",
      `"${name}" names rule ${ruleId}, which rules.json does not hold, so it never runs and the flow stays visible.`,
      { name, rule: ruleId },
    );
  }
  const action = text(
    ((attached.ruleAction as Rec | undefined)?.metaData as Rec | undefined)
      ?.action,
  );
  return gate(
    "segments",
    "unknown",
    "C4X-05",
    "ruleDecides4x",
    `Rule ${text(rule?.name) ?? ruleId} decides in the browser whether "${name}" is shown${action ? ` (action: ${action})` : ""}.`,
    { name, rule: text(rule?.name) ?? ruleId },
  );
}
