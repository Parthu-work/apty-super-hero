/**
 * Check pack for "the Apty widget is not showing", from the RAG cards
 * "widget is not appearing on the application" (JA 1496645690), "widget
 * works in Test but not in Production" (JA 1496645709), "the widget shows on
 * every page but content fails on some pages because the environment URL is
 * too specific" (JA 1497104451), "app-urls.json response, what it means"
 * (JA 1496253321) and "widget shows for every user although it is set to
 * selected segments" (JA 1496645745). Every rule is from 5.x code at 4c406d5
 * or support cases, not runtime-verified, so a finding is never more certain
 * than "likely".
 *
 * The gates only read: the page the user has open against the environments'
 * URL patterns, the environment's own rule, and the widget's audience. What
 * only the browser decides (segment membership, rules, the page's CSS) stays
 * open, never guessed (P4).
 */
import {
  FILE_PROBLEMS,
  fileOf,
  fileParams,
  jsonOf,
  looks4x,
  makeGate,
  type Rec,
  records,
  short,
  text,
  texts,
} from "./pack-kit.js";
import type {
  Cause,
  ClientEvidence,
  DiagnosisResult,
  GateId,
  GateReason,
  GateResult,
  GateStatus,
  NextCheck,
  NotChecked,
  Params,
  RuleId,
  Verdict,
} from "./types.js";
import { type EnvironmentMatch, matchEnvironments } from "./url-patterns.js";

const WIDGET_CARD = "1496645690";
const CARD_APP_URLS = "1496253321";
const CARD_TEST_PROD = "1496645709";
const CARD_TOO_SPECIFIC = "1497104451";
const CARD_SEGMENTS = "1496645745";
const CARD_SEGMENT_JSON = "1496940545";
const VERIFIED_ON =
  "5.x code, commit 4c406d5, 2026-09-22, and support cases; not runtime-verified";

export const WIDGET_FILES = [
  "app-urls.json",
  "app-data.json",
  "segment.json",
  "rule.json",
];

function gate(
  id: GateId,
  status: GateStatus,
  ruleId: RuleId,
  reason: GateReason,
  detail: string,
  params: Params = {},
  evidence: string[] = [],
  cardPageId = WIDGET_CARD,
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

function finish(
  evidence: ClientEvidence,
  gates: GateResult[],
  verdict: Verdict,
  notChecked: NotChecked[] = [],
): DiagnosisResult {
  return {
    packId: "widget-not-visible",
    cardPageId: WIDGET_CARD,
    verifiedOn: VERIFIED_ON,
    subject: { kind: "widget", matched: [] },
    gates,
    verdict,
    confidence: verdict.status === "no_data" ? "unknown" : "likely",
    files: WIDGET_FILES.map((name) => {
      const file = fileOf(evidence, name);
      return {
        name,
        status: file.status,
        ...(file.httpStatus !== undefined
          ? { httpStatus: file.httpStatus }
          : {}),
      };
    }),
    notChecked,
  };
}

function isWebPage(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//.test(url);
}

const orderOf = (m: EnvironmentMatch) => `${m.name} (order ${m.order})`;

interface Step {
  gates: GateResult[];
  causes: Cause[];
  next?: NextCheck;
}

function environmentStep(
  evidence: ClientEvidence,
  pageUrl: string,
): Step & { winner?: EnvironmentMatch } {
  const all = matchEnvironments(jsonOf(evidence, "app-urls.json"), pageUrl);
  const matching = all.filter((m) => m.matches);
  if (matching.length === 0) {
    const sameHost = all.filter((m) => m.sameHost);
    if (sameHost.length > 0) {
      const names = sameHost.map(orderOf).join(", ");
      const cause: Cause = {
        ruleId: "WNV-03",
        cardPageId: CARD_TOO_SPECIFIC,
        params: { envs: names },
        summary: `${names} has a URL pattern for this site that does not cover this page, so no content runs here.`,
        fix: "In Admin, set the environment's URL to the application's base URL (a * covers every page under it), publish and reload. Change a test environment first if there is one.",
        evidence: sameHost.map(
          (m) => `${orderOf(m)}: same host, the pattern's path does not match`,
        ),
      };
      return {
        gates: [
          gate(
            "environment-match",
            "fail",
            "WNV-03",
            "envTooSpecific",
            cause.summary,
            cause.params,
            cause.evidence,
            CARD_TOO_SPECIFIC,
          ),
        ],
        causes: [cause],
      };
    }
    const checked = all.map(orderOf).join(", ") || "none";
    const cause: Cause = {
      ruleId: "WNV-02",
      cardPageId: WIDGET_CARD,
      params: { envs: checked },
      summary:
        "No environment's URL pattern matches this page, so nothing from Apty loads here.",
      fix: 'In Admin, add the exact host users open (with or without www) to the right environment\'s URLs, publish and reload. With the Console set to Verbose, "No active application found" confirms it.',
      evidence: [
        `environments checked: ${checked}`,
        "none has a pattern for this page's host",
      ],
    };
    return {
      gates: [
        gate(
          "environment-match",
          "fail",
          "WNV-02",
          "noEnvMatch",
          cause.summary,
          cause.params,
          cause.evidence,
        ),
      ],
      causes: [cause],
    };
  }

  const winner = matching[0] as EnvironmentMatch;
  const gates: GateResult[] = [
    gate(
      "environment-match",
      "pass",
      "WNV-02",
      "envMatch",
      `This page belongs to ${orderOf(winner)}.`,
      { env: winner.name, order: winner.order },
      [`first match by order: ${orderOf(winner)}`],
      CARD_APP_URLS,
    ),
  ];
  let next: NextCheck | undefined;
  if (matching.length > 1) {
    const others = matching.slice(1).map(orderOf).join(", ");
    gates.push(
      gate(
        "environment-match",
        "unknown",
        "WNV-04",
        "severalEnvMatch",
        `${orderOf(winner)} wins on this page; ${others} ${matching.length > 2 ? "also match" : "also matches"}. Users here get ${winner.name}'s content.`,
        { env: orderOf(winner), others },
        matching.map((m) => `${orderOf(m)} matches this page`),
        CARD_TEST_PROD,
      ),
    );
    next = "comparePatterns";
  }
  const loaded = evidence.envId?.replace(/^env-/, "");
  if (loaded && text(winner.env.id) && loaded !== winner.env.id) {
    const loadedName =
      all.find((m) => m.env.id === loaded)?.name ?? short(loaded);
    gates.push(
      gate(
        "environment-match",
        "unknown",
        "WNV-02",
        "otherEnvLoaded",
        `The files the Apty Client read are for ${loadedName}, not ${winner.name}: they may come from another tab.`,
        { loaded: loadedName, env: winner.name },
        [],
        CARD_APP_URLS,
      ),
    );
    next ??= "reload";
  }
  const ruleId = text(winner.env.visibilityRuleId);
  if (ruleId) {
    const rule = records(jsonOf(evidence, "rule.json")).find(
      (r) => r.id === ruleId,
    );
    const name = text(rule?.name) ?? short(ruleId);
    const action = String(winner.env.visibilityRuleAction ?? "SHOW");
    gates.push(
      gate(
        "environment-match",
        "unknown",
        "WNV-05",
        "envVisibilityRule",
        `${winner.name} has its own visibility rule "${name}" (${action}), evaluated in the browser.`,
        { env: winner.name, rule: name, action },
        [],
        CARD_APP_URLS,
      ),
    );
  }
  return { gates, causes: [], next, winner };
}

/**
 * The widget's own audience. Segment rows follow segment.json's card: an
 * inactive row, or one whose rule is missing, can never be active. What a
 * selected segment that is not in segment.json does to the widget is not
 * verified, so it stays open.
 */
function audienceStep(evidence: ClientEvidence): Step {
  const appData = jsonOf(evidence, "app-data.json") as Rec | undefined;
  const widgetConfig = (appData?.config as Rec | undefined)?.widgetConfig as
    | Rec
    | undefined;
  if (!widgetConfig) {
    return {
      gates: [
        gate(
          "widget-audience",
          "unknown",
          "WNV-06",
          "appDataUnread",
          "app-data.json was not read, so the widget's audience is unknown.",
          {},
          [],
          CARD_SEGMENTS,
        ),
      ],
      causes: [],
    };
  }
  const display = String(widgetConfig.display);
  const shape = [`app-data.json: widgetConfig.display = ${display}`];
  if (widgetConfig.display !== "Specific") {
    return {
      gates: [
        gate(
          "widget-audience",
          "pass",
          "WNV-06",
          "widgetForAll",
          `The widget is not limited to selected segments (display ${display}).`,
          { display },
          shape,
          CARD_SEGMENTS,
        ),
      ],
      causes: [],
    };
  }
  if (widgetConfig.enabledForOtherUser === true) {
    return {
      gates: [
        gate(
          "widget-audience",
          "pass",
          "WNV-06",
          "widgetOtherUsers",
          "The widget is for selected segments, and the option for other users is on, so users in no active segment see it too.",
          {},
          [...shape, "widgetConfig.enabledForOtherUser = true"],
          CARD_SEGMENTS,
        ),
      ],
      causes: [],
    };
  }

  const segmentFile = fileOf(evidence, "segment.json");
  const rows = segmentFile.status === "ok" ? records(segmentFile.json) : [];
  const ruleFile = fileOf(evidence, "rule.json");
  const ruleIds =
    ruleFile.status === "ok"
      ? new Set(records(ruleFile.json).map((r) => text(r.id)))
      : undefined;
  const selected = texts(widgetConfig.selectedSegments);
  const states = selected.map((id) => {
    const row = rows.find((r) => r.id === id);
    const name = text(row?.name) ?? short(id);
    if (!row) return { name, state: "missing" as const };
    if (row.isActive !== true) return { name, state: "turned off" as const };
    if (ruleIds && !ruleIds.has(text(row.ruleId))) {
      return { name, state: "rule missing" as const };
    }
    return { name, state: "usable" as const };
  });
  const lines = [
    ...shape,
    "widgetConfig.enabledForOtherUser = false",
    ...states.map((s) => `segment ${s.name}: ${s.state}`),
  ];
  if (selected.length === 0) {
    const cause: Cause = {
      ruleId: "WNV-07",
      cardPageId: WIDGET_CARD,
      params: { variant: "noneChosen" },
      summary:
        "The widget is set to show only to specific segments, but none is chosen, and the option for other users is off: nobody sees it.",
      fix: 'In Admin, under "TARGET AUDIENCE", choose the widget\'s segments or enable the widget for all users. Publish and reload.',
      evidence: [...lines, "widgetConfig.selectedSegments = []"],
    };
    return {
      gates: [
        gate(
          "widget-audience",
          "fail",
          "WNV-07",
          "widgetNoSegmentChosen",
          cause.summary,
          cause.params,
          cause.evidence,
        ),
      ],
      causes: [cause],
    };
  }
  const usable = states.filter((s) => s.state === "usable");
  if (usable.length > 0) {
    const names = usable.map((s) => s.name).join(", ");
    return {
      gates: [
        gate(
          "widget-audience",
          "unknown",
          "WNV-06",
          "widgetLimited",
          `The widget is shown only to the segments ${names}; the user must be in one of them.`,
          { segments: names },
          lines,
          CARD_SEGMENTS,
        ),
      ],
      causes: [],
      next: "testAsMember",
    };
  }
  if (
    states.some((s) => s.state === "missing") ||
    segmentFile.status !== "ok"
  ) {
    const names = states.map((s) => `${s.name} (${s.state})`).join(", ");
    return {
      gates: [
        gate(
          "widget-audience",
          "unknown",
          "WNV-06",
          "widgetSegmentsMissing",
          `The widget's segments are not all in segment.json here (${names || "segment.json not read"}); what that does to the widget is not verified.`,
          { segments: names },
          lines,
          CARD_SEGMENT_JSON,
        ),
      ],
      causes: [],
    };
  }
  const names = states.map((s) => `${s.name} (${s.state})`).join(", ");
  const cause: Cause = {
    ruleId: "WNV-07",
    cardPageId: WIDGET_CARD,
    params: { segments: names },
    summary: `The widget is limited to segments that can never be active here (${names}), and the option for other users is off: nobody sees it.`,
    fix: 'In Admin, under "TARGET AUDIENCE", turn one of the widget\'s segments on or fix its rule, or enable the widget for all users. Publish and reload.',
    evidence: lines,
  };
  return {
    gates: [
      gate(
        "widget-audience",
        "fail",
        "WNV-07",
        "widgetNoActiveSegment",
        cause.summary,
        cause.params,
        lines,
      ),
    ],
    causes: [cause],
  };
}

function restrictionGate(evidence: ClientEvidence): GateResult | undefined {
  const widgetConfig = (
    (jsonOf(evidence, "app-data.json") as Rec | undefined)?.config as
      | Rec
      | undefined
  )?.widgetConfig as Rec | undefined;
  const count = Array.isArray(widgetConfig?.restrictionPatterns)
    ? (widgetConfig.restrictionPatterns as unknown[]).length
    : 0;
  if (count === 0) return undefined;
  return gate(
    "restriction",
    "unknown",
    "WNV-06",
    "restrictionPatterns",
    `${count} restriction pattern(s) are set; they can hide the whole widget. Check them in Admin.`,
    { count },
    [`app-data.json: ${count} restriction pattern(s)`],
    "1496842241",
  );
}

/**
 * Runs the pack on what the loader read, for the page open in the user's tab
 * when one is known.
 */
export function diagnoseWidgetNotVisible(
  evidence: ClientEvidence,
  pageUrl?: string,
): DiagnosisResult {
  if (!evidence.connection.ok) {
    const { message, failure } = evidence.connection;
    const data = gate(
      "data",
      "fail",
      "WNV-00",
      "clientUnreachable",
      `Could not reach the Apty Client: ${message}`,
      { message, failure },
    );
    return finish(evidence, [data], {
      status: "no_data",
      headline: data.detail,
      causes: [],
      nextCheck: "fixConnection",
    });
  }
  if (looks4x(evidence)) {
    return finish(
      evidence,
      [
        gate(
          "version",
          "fail",
          "CNV-V5",
          "version4x",
          "This tenant uses 4.x content files (flow.json, segments.json). The checks are verified for 5.x only.",
        ),
      ],
      {
        status: "out_of_scope",
        headline:
          "This looks like a 4.x tenant. The KB cards are not verified for 4.x, so nothing was concluded.",
        causes: [],
        nextCheck: "manual4x",
      },
    );
  }

  const appUrls = fileOf(evidence, "app-urls.json");
  if (appUrls.status === "empty") {
    const cause: Cause = {
      ruleId: "WNV-01",
      cardPageId: CARD_APP_URLS,
      params: { httpStatus: appUrls.httpStatus ?? 0 },
      summary:
        "app-urls.json is an empty list: no application is defined, or the file failed its schema check, so Apty loads nothing on any page.",
      fix: 'Read its status code, then the Console for "Error fetching data" or "Error parsing response". If one entry is malformed, fix it in Admin and publish.',
      evidence: [`app-urls.json: [] (HTTP ${appUrls.httpStatus})`],
    };
    return finish(
      evidence,
      [
        gate(
          "data",
          "fail",
          "WNV-01",
          "appUrlsEmpty",
          cause.summary,
          cause.params,
          cause.evidence,
          CARD_APP_URLS,
        ),
      ],
      {
        status: "cause_found",
        headline: cause.summary,
        causes: [cause],
        nextCheck: "readStatus",
      },
    );
  }
  if (appUrls.status !== "ok") {
    const problem = FILE_PROBLEMS[appUrls.status];
    const data = gate(
      "data",
      "fail",
      "WNV-00",
      problem.reason,
      problem.text(appUrls),
      fileParams(appUrls),
    );
    return finish(evidence, [data], {
      status: "no_data",
      headline: data.detail,
      causes: [],
      nextCheck: problem.nextCheck,
    });
  }

  const gates: GateResult[] = [
    gate(
      "data",
      "pass",
      "WNV-00",
      "filesRead",
      `app-urls.json read (${records(appUrls.json).length} application(s)).`,
      { file: "app-urls.json", count: records(appUrls.json).length },
      WIDGET_FILES.map((name) => {
        const file = fileOf(evidence, name);
        return `${name}: ${file.status}${file.httpStatus ? ` (HTTP ${file.httpStatus})` : ""}`;
      }),
    ),
  ];
  const causes: Cause[] = [];
  const nexts: NextCheck[] = [];

  if (isWebPage(pageUrl)) {
    gates.push(
      gate(
        "page",
        "pass",
        "WNV-02",
        "pageRead",
        "Checked against the page open in this tab.",
      ),
    );
    const env = environmentStep(evidence, pageUrl);
    gates.push(...env.gates);
    causes.push(...env.causes);
    if (env.next) nexts.push(env.next);
  } else {
    gates.push(
      gate(
        "page",
        "unknown",
        "WNV-02",
        "pageUnknown",
        "No web page is open in this tab, so the environments' URL patterns were not checked.",
      ),
    );
    nexts.push("openAppPage");
  }

  const audience = audienceStep(evidence);
  gates.push(...audience.gates);
  causes.push(...audience.causes);
  if (audience.next) nexts.push(audience.next);
  const restriction = restrictionGate(evidence);
  if (restriction) gates.push(restriction);

  const notChecked: NotChecked[] = [
    "membership",
    "runtime-rules",
    "widget-css",
  ];
  const open = gates.some((g) => g.status === "unknown");
  const verdict: Verdict =
    causes.length > 0
      ? {
          status: "cause_found",
          headline: causes[0]?.summary ?? "",
          causes,
          ...(open ? { nextCheck: "openItems" as const } : {}),
        }
      : open
        ? {
            status: "candidates",
            headline:
              "No blocker for the widget in the files. What is left is decided in the browser.",
            causes: [],
            nextCheck: nexts[0] ?? "openItems",
          }
        : {
            status: "no_cause_in_data",
            headline:
              "No cause in the files. Check whether the page's CSS hides the widget container.",
            causes: [],
            nextCheck: "sendSupport",
          };
  return finish(evidence, gates, verdict, notChecked);
}
