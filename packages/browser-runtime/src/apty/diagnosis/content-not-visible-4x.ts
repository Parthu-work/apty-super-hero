/**
 * Check pack for "my flow is not showing" on a 4.x tenant (KB-RAG K14,
 * D-KB7): the 4.x counterpart of the 5.x workflow checks, from 4.x
 * content files. flow.json lists the published flows (a flow's `name` per
 * locale, `hideInWidget`), `flow-<id>.json` a flow's steps, segments.json
 * the segments (`isActive`, `ruleId` and the `flows` each lists) and
 * rules.json their rules. Ported from the behaviour FIXES.md K14
 * describes (apty-assist `player3.0/src/shared/helpers/cdn-helpers.ts`
 * reads these files, per FIXES.md); not yet checked against apty-assist
 * code and not runtime-verified, so no finding is more certain than
 * "possible".
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
} from "./widget-not-visible-4x.js";

export const CONTENT_FILES_4X = ["flow.json", "segments.json", "rules.json"];

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
        : ["membership", "runtime-rules"],
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
  "C4X-04": "allInactive",
  "C4X-05": "rulesMissing4x",
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

  if (flow.hideInWidget === true) {
    return found(
      draft,
      gates,
      causeOf(
        "C4X-03",
        `"${name}" is hidden from the widget (flow.json hideInWidget).`,
        "In 4.x Studio, clear the flow's hide-in-widget option, publish and reload.",
        { name },
        ["flow.json: hideInWidget = true"],
      ),
      name,
    );
  }

  const segments = records(jsonOf(evidence, "segments.json")).filter((s) =>
    (Array.isArray(s.flows) ? s.flows : []).some((f) => String(f) === id),
  );
  if (segments.length > 0 && segments.every((s) => s.isActive !== true)) {
    const names = segments.map((s) => text(s.name) ?? String(s.id)).join(", ");
    return found(
      draft,
      gates,
      causeOf(
        "C4X-04",
        `Every segment that lists "${name}" is turned off (${names}), so nobody gets it.`,
        "In 4.x Admin, turn one of its segments on, or add the flow to an active segment, then publish.",
        { name, segments: names },
        segments.map((s) => `segment ${text(s.name) ?? s.id}: turned off`),
      ),
      name,
    );
  }
  const rulesFile = fileOf(evidence, "rules.json");
  if (rulesFile.status === "ok") {
    const ruleIds = new Set(records(rulesFile.json).map((r) => String(r.id)));
    const active = segments.filter((s) => s.isActive === true);
    const broken = active.filter(
      (s) => s.ruleId != null && !ruleIds.has(String(s.ruleId)),
    );
    if (active.length > 0 && broken.length === active.length) {
      const names = broken.map((s) => text(s.name) ?? String(s.id)).join(", ");
      return found(
        draft,
        gates,
        causeOf(
          "C4X-05",
          `The rules of the segments that list "${name}" are missing from rules.json (${names}), so they can never match.`,
          "In 4.x Admin, fix or re-create the segment's rule, publish and reload.",
          { name, segments: names },
          broken.map(
            (s) =>
              `segment ${text(s.name) ?? s.id}: rule ${s.ruleId} not in rules.json`,
          ),
        ),
        name,
      );
    }
  }
  gates.push(
    gate(
      "segments",
      "unknown",
      "C4X-04",
      segments.length === 0 ? "noSegments" : "mustMatch",
      segments.length === 0
        ? `No segment lists "${name}", so every user can get it.`
        : `"${name}" is for the users of its active segments; whether this user is one is decided in the browser.`,
      { name },
    ),
  );

  const stepsFile = fileOf(evidence, flowStepsFile(id));
  let next: NextCheck | undefined;
  if (stepsFile.status === "ok") {
    const steps = records((stepsFile.json as Rec | undefined)?.steps);
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
