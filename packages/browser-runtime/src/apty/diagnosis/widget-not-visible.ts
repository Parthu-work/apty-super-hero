/**
 * Check pack for "the Apty widget is not showing", from the RAG cards on the
 * widget missing from the whole application (JA 1496645690), the widget
 * missing in Production only (JA 1496645709), an environment URL pattern
 * too specific for some pages (JA 1497104451), the app-urls.json mirror
 * card (JA 1496253321) and the widget shown to users outside its segments
 * (JA 1496645745). Every rule is from 5.x code at 4c406d5
 * or support cases, not runtime-verified, so a finding is never more certain
 * than "likely".
 *
 * The gates only read: the page the user has open against the environments'
 * URL patterns, the environment's own rule, and the widget's audience. What
 * only the browser decides (segment membership, rules, the page's CSS) stays
 * open, never guessed (P4).
 */
import {
  releaseAtLeast,
  WIDGET_DISPLAY_PER_ENVIRONMENT_FROM,
} from "@apty/agent-core";
import {
  FILE_PROBLEMS,
  fileOf,
  fileParams,
  jsonOf,
  looks4x,
  makeGate,
  playerVersionOf,
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
import {
  type EnvironmentMatch,
  type HostPitfall,
  matchEnvironments,
} from "./url-patterns.js";
import { diagnoseWidgetNotVisible4x } from "./widget-not-visible-4x.js";

export const WIDGET_CARD = "1496645690";
const CARD_APP_URLS = "1496253321";
const CARD_TEST_PROD = "1496645709";
const CARD_TOO_SPECIFIC = "1497104451";
const CARD_SEGMENTS = "1496645745";
const CARD_SEGMENT_JSON = "1496940545";
const VERIFIED_ON =
  "5.x code, commit 3f3adba, 2026-11-28 (widget audience; 9b2eef11 and 3ad61ef9 for the per-environment display), 4c406d5 for the rest, and support cases; not runtime-verified";

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

const PITFALL_TEXT: Record<HostPitfall, string> = {
  upperCaseHost:
    "the pattern's host has capital letters, which a page's URL never has",
  defaultPort:
    "the pattern names the default port (:443 or :80), which a page's URL never shows",
};

const whyNoMatch = (m: EnvironmentMatch) =>
  m.hostPitfalls.length > 0
    ? m.hostPitfalls.map((p) => `${orderOf(m)}: ${PITFALL_TEXT[p]}`)
    : [`${orderOf(m)}: same host, the pattern's path does not match`];

interface Step {
  gates: GateResult[];
  causes: Cause[];
  next?: NextCheck;
}

function regexFlagGate(
  off: EnvironmentMatch | undefined,
  on: EnvironmentMatch,
): { reason: GateReason; detail: string; params: Params } {
  if (on.regex === "invalid") {
    const flagsOff = off
      ? `this page gets ${orderOf(off)}`
      : "no environment matches this page";
    const detail = `${orderOf(on)} has a URL pattern that is not a valid regular expression: with the regex URL flags on, the player stops with an error there, so the widget does not load for this application; with them off, ${flagsOff}.`;
    return off
      ? {
          reason: "envRegexInvalid",
          detail,
          params: { env: orderOf(on), flagsOff: orderOf(off) },
        }
      : {
          reason: "envRegexInvalidNoMatch",
          detail,
          params: { env: orderOf(on) },
        };
  }
  return off
    ? {
        reason: "envRegexFlip",
        detail: `With the regex URL flags off this page gets ${orderOf(off)}; with them on, ${orderOf(on)} matches it as a regular expression and comes first by order.`,
        params: { flagsOff: orderOf(off), flagsOn: orderOf(on) },
      }
    : {
        reason: "envRegexOnly",
        detail: `No environment matches this page with the regex URL flags off, so nothing from Apty loads here; with them on, ${orderOf(on)} matches it as a regular expression.`,
        params: { env: orderOf(on) },
      };
}

/**
 * When the tenant's regex URL flags would change the pick, neither pick is
 * asserted: the flags are in no file the Client reports. Only for a 4.x
 * player, or one the files do not tell: the 5.x player never turns them on.
 */
function regexFlagStep(all: EnvironmentMatch[]): Step | undefined {
  const off = all.find((m) => m.matches);
  const on = all.find((m) => m.regex !== "none");
  if (!on || (on === off && on.regex === "match")) return undefined;
  const { reason, detail, params } = regexFlagGate(off, on);
  return {
    gates: [
      gate(
        "environment-match",
        "unknown",
        "WNV-08",
        reason,
        `${detail} Whether the flags are on is not in the files.`,
        params,
        [
          `regex URL flags off: ${off ? `first match by order: ${orderOf(off)}` : "no environment matches"}`,
          `regex URL flags on: ${on.regex === "invalid" ? `${orderOf(on)} has a pattern that is not a valid regex, so the player throws` : `first match by order: ${orderOf(on)}`}`,
        ],
        CARD_APP_URLS,
      ),
    ],
    causes: [],
    next: "askRegexFlag",
  };
}

function environmentStep(
  evidence: ClientEvidence,
  pageUrl: string,
): Step & { winner?: EnvironmentMatch } {
  const regexFlags = playerVersionOf(evidence) !== "5.x";
  const all = matchEnvironments(jsonOf(evidence, "app-urls.json"), pageUrl, {
    regexFlags,
  });
  const regexFlag = regexFlags ? regexFlagStep(all) : undefined;
  if (regexFlag) return regexFlag;
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
        evidence: sameHost.flatMap(whyNoMatch),
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
      evidence: [`environments checked: ${checked}`, "matching patterns: 0"],
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
  if (winner.onlyEmptyPatternMatches) {
    gates.push(
      gate(
        "environment-match",
        "unknown",
        "WNV-04",
        "emptyPatternMatch",
        `${orderOf(winner)} matches this page only through an empty URL pattern, which matches every page.`,
        { env: orderOf(winner) },
        [`${orderOf(winner)}: an empty URL pattern`],
        CARD_TEST_PROD,
      ),
    );
    next = "comparePatterns";
  }
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
    next ??= "comparePatterns";
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

/** Who sees the widget, as one stored setting says. */
interface DisplaySetting {
  display: unknown;
  selectedSegments: unknown;
  /** Only the application-level setting has it, and only players before 5.2.4 read it. */
  enabledForOtherUser?: unknown;
  /** Where the setting is stored, for the evidence lines. */
  where: string;
  /** The environment the setting is for; absent for the application-level one. */
  env?: string;
}

/**
 * The widget's audience under one setting, mirroring the player's display
 * match: All shows it, Specific needs an active selected segment, anything
 * else hides it. Before 5.2.4 (application-level `widgetConfig`) a Specific
 * widget also shows when no segment at all is active and
 * `enabledForOtherUser` is on
 * (apty-dap:packages/apps/player/src/main-content-script/segment/segments.service.ts:67-79@9b2eef11^);
 * from 5.2.4 the environment's `widgetDisplayConfig` decides and has no such
 * option (segments.service.ts:67-79@3f3adba). Segment rows follow
 * segment.json's card: an inactive segment, or one whose rule is missing
 * from rule.json, never matches. What a selected segment that is not in
 * segment.json does to the widget is not verified, so it stays open.
 */
function audienceOf(evidence: ClientEvidence, setting: DisplaySetting): Step {
  const display = String(setting.display);
  const shape = [`${setting.where}.display = ${display}`];
  if (setting.display === "All") {
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
  if (setting.display !== "Specific") {
    const cause: Cause = {
      ruleId: "WNV-07",
      cardPageId: WIDGET_CARD,
      params: setting.env
        ? { variant: "envDisplayNone", env: setting.env, display }
        : { variant: "displayNone", display },
      summary: setting.env
        ? `The widget is turned off for ${setting.env} (display ${display}): nobody sees it there.`
        : `The widget is turned off (display ${display}): nobody sees it.`,
      fix: setting.env
        ? `In Admin, open ${setting.env}'s widget display setting and choose All or specific segments. Publish and reload.`
        : 'In Admin, under "TARGET AUDIENCE", show the widget to all users or to specific segments. Publish and reload.',
      evidence: shape,
    };
    return {
      gates: [
        gate(
          "widget-audience",
          "fail",
          "WNV-07",
          "widgetDisplayNone",
          cause.summary,
          cause.params,
          cause.evidence,
        ),
      ],
      causes: [cause],
    };
  }
  if (setting.env === undefined && setting.enabledForOtherUser === true) {
    return {
      gates: [
        gate(
          "widget-audience",
          "pass",
          "WNV-06",
          "widgetOtherUsers",
          "The widget is for selected segments, and the option for other users is on, so users in no active segment see it too.",
          {},
          [...shape, `${setting.where}.enabledForOtherUser = true`],
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
  const selected = texts(setting.selectedSegments);
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
    ...(setting.env === undefined
      ? [`${setting.where}.enabledForOtherUser = false`]
      : []),
    ...states.map((s) => `segment ${s.name}: ${s.state}`),
  ];
  if (selected.length === 0) {
    const cause: Cause = {
      ruleId: "WNV-07",
      cardPageId: WIDGET_CARD,
      params: setting.env
        ? { variant: "envNoneChosen", env: setting.env }
        : { variant: "noneChosen" },
      summary: setting.env
        ? `${setting.env}'s widget display is set to specific segments, but none is chosen: nobody sees the widget there.`
        : "The widget is set to show only to specific segments, but none is chosen, and the option for other users is off: nobody sees it.",
      fix: setting.env
        ? `In Admin, open ${setting.env}'s widget display setting and choose its segments, or show the widget to all users. Publish and reload.`
        : 'In Admin, under "TARGET AUDIENCE", choose the widget\'s segments or enable the widget for all users. Publish and reload.',
      evidence: [...lines, `${setting.where}.selectedSegments = []`],
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
    params: setting.env
      ? { variant: "envNoActiveSegment", env: setting.env, segments: names }
      : { segments: names },
    summary: setting.env
      ? `${setting.env}'s widget display is limited to segments that can never be active here (${names}): nobody sees the widget there.`
      : `The widget is limited to segments that can never be active here (${names}), and the option for other users is off: nobody sees it.`,
    fix: setting.env
      ? `In Admin, turn one of the segments in ${setting.env}'s widget display setting on or fix its rule, or show the widget to all users. Publish and reload.`
      : 'In Admin, under "TARGET AUDIENCE", turn one of the widget\'s segments on or fix its rule, or enable the widget for all users. Publish and reload.',
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

/**
 * The environment's widget display setting (players from 5.2.4). A missing
 * or null setting, or an environment app-data.json does not list, hides the
 * widget (`resolveWidgetDisplay`,
 * apty-dap:packages/libs/shared/contracts/src/accounts/application-config/application-config.schema.ts:287-295@3f3adba).
 */
function environmentAudience(
  evidence: ClientEvidence,
  appData: Rec,
  envId: string | undefined,
  envName: string | undefined,
): Step {
  if (!envId) {
    return {
      gates: [
        gate(
          "widget-audience",
          "unknown",
          "WNV-07",
          "widgetEnvUnknown",
          "Which environment this page uses is not known, so its widget display setting was not read.",
          {},
          [],
          CARD_SEGMENTS,
        ),
      ],
      causes: [],
      next: "openAppPage",
    };
  }
  const environments = records(appData.environments);
  const row = environments.find((e) => e.id === envId);
  const env = text(row?.name) ?? envName ?? short(envId);
  const config = row?.widgetDisplayConfig;
  if (!config || typeof config !== "object") {
    const where = row
      ? `app-data.json: environment ${env}.widgetDisplayConfig = ${config === null ? "null" : "missing"}`
      : `app-data.json: environment ${env} not listed`;
    const cause: Cause = {
      ruleId: "WNV-07",
      cardPageId: WIDGET_CARD,
      params: { variant: "envNoSetting", env },
      summary: `The widget is turned off for ${env}: no widget display setting is saved for it, and the player hides the widget then.`,
      fix: `In Admin, open ${env}'s widget display setting, choose All or specific segments and save. Publish and reload.`,
      evidence: [where],
    };
    return {
      gates: [
        gate(
          "widget-audience",
          "fail",
          "WNV-07",
          "widgetEnvNoSetting",
          cause.summary,
          cause.params,
          cause.evidence,
        ),
      ],
      causes: [cause],
    };
  }
  const setting = config as Rec;
  return audienceOf(evidence, {
    display: setting.display,
    selectedSegments: setting.selectedSegments,
    where: `app-data.json: environment ${env}.widgetDisplayConfig`,
    env,
  });
}

const outcomeOf = (step: Step) =>
  step.gates.find((g) => g.id === "widget-audience")?.status ?? "unknown";

const outcomeText = (step: Step) =>
  step.gates.find((g) => g.id === "widget-audience")?.detail ?? "";

const sameSetting = (a: Rec | undefined, b: Rec) =>
  a !== undefined &&
  a.display === b.display &&
  JSON.stringify(texts(a.selectedSegments).sort()) ===
    JSON.stringify(texts(b.selectedSegments).sort());

/**
 * Notes for a player before 5.2.4 on a page of another environment than
 * Production: it shows the widget by the application-level setting, which
 * the server keeps equal to Production's from apty-dap 3ad61ef9 on
 * (AUDIT-CORRECTIONS F1).
 */
function olderPlayerNotes(
  appData: Rec,
  widgetConfig: Rec,
  envId: string | undefined,
): GateResult[] {
  const environments = records(appData.environments);
  const production = environments.find((e) => e.order === 1);
  const notes: GateResult[] = [];
  const here = environments.find((e) => e.id === envId);
  if (here && production && here.id !== production.id) {
    const env = text(here.name) ?? short(String(here.id));
    notes.push(
      gate(
        "widget-audience",
        "info",
        "WNV-06",
        "widgetFollowsProduction",
        `Players before 5.2.4 show the widget on ${env} by Production's display setting, not ${env}'s own.`,
        { env },
        [],
        CARD_SEGMENTS,
      ),
    );
  }
  const productionSetting = production?.widgetDisplayConfig;
  const resolved =
    productionSetting && typeof productionSetting === "object"
      ? (productionSetting as Rec)
      : { display: "None", selectedSegments: [] };
  if (production && !sameSetting(widgetConfig, resolved)) {
    notes.push(
      gate(
        "widget-audience",
        "info",
        "WNV-06",
        "widgetMirrorPending",
        `The application-level widget setting (display ${String(widgetConfig.display)}) differs from Production's (display ${String(resolved.display)}): no environment was saved since Apty began copying Production's setting there, so players before 5.2.4 still use the older one.`,
        {
          app: String(widgetConfig.display),
          production: String(resolved.display),
        },
        [],
        CARD_SEGMENTS,
      ),
    );
  }
  return notes;
}

const APP_LEVEL_KEYS = ["display", "selectedSegments", "enabledForOtherUser"];

const appLevelIgnored = (widgetConfig: Rec | undefined): GateResult[] =>
  widgetConfig && APP_LEVEL_KEYS.some((k) => widgetConfig[k] !== undefined)
    ? [
        gate(
          "widget-audience",
          "info",
          "WNV-06",
          "widgetAppLevelIgnored",
          "The application-level widget audience has no effect in players from 5.2.4: the environment's display setting decides.",
          {},
          [],
          CARD_SEGMENTS,
        ),
      ]
    : [];

/**
 * The widget's audience. Since apty-dap 9b2eef11 (player 5.2.4, decision
 * D-RELEASES) the environment's `widgetDisplayConfig` decides; older
 * players read the application-level `widgetConfig` (AUDIT-CORRECTIONS A6,
 * F1). When the player's release is not known, a result both rules agree on
 * stands; otherwise the row stays open naming both.
 */
function audienceStep(
  evidence: ClientEvidence,
  envId: string | undefined,
  envName?: string,
): Step {
  const appData = jsonOf(evidence, "app-data.json") as Rec | undefined;
  const widgetConfig = (appData?.config as Rec | undefined)?.widgetConfig as
    | Rec
    | undefined;
  if (!appData || !widgetConfig) {
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
  const older = audienceOf(evidence, {
    display: widgetConfig.display,
    selectedSegments: widgetConfig.selectedSegments,
    enabledForOtherUser: widgetConfig.enabledForOtherUser,
    where: "app-data.json: widgetConfig",
  });
  const current = environmentAudience(evidence, appData, envId, envName);
  const perEnvironment = evidence.playerRelease
    ? releaseAtLeast(
        evidence.playerRelease,
        WIDGET_DISPLAY_PER_ENVIRONMENT_FROM,
      )
    : undefined;
  if (perEnvironment === true) {
    return {
      ...current,
      gates: [...current.gates, ...appLevelIgnored(widgetConfig)],
    };
  }
  if (perEnvironment === false) {
    return {
      ...older,
      gates: [
        ...older.gates,
        ...olderPlayerNotes(appData, widgetConfig, envId),
      ],
    };
  }
  const now = outcomeOf(current);
  const before = outcomeOf(older);
  if (now === before) {
    const agreed =
      now === "fail"
        ? current.causes.map((cause) => ({
            ...cause,
            evidence: [
              ...cause.evidence,
              `players before 5.2.4: ${outcomeText(older)}`,
            ],
          }))
        : current.causes;
    return { ...current, causes: agreed };
  }
  return {
    gates: [
      gate(
        "widget-audience",
        "unknown",
        "WNV-07",
        "widgetDisplayVersionGated",
        `Players from 5.2.4: ${outcomeText(current)} Players before 5.2.4: ${outcomeText(older)} Which applies depends on the Apty player's version.`,
        { now, before },
        [
          ...current.gates.flatMap((g) => g.evidence),
          ...older.gates.flatMap((g) => g.evidence),
        ],
        CARD_SEGMENTS,
      ),
      ...olderPlayerNotes(appData, widgetConfig, envId),
    ],
    causes: [],
    next: "askPlayerVersion",
  };
}

/** The page's environment, else the one the content files were read for. */
const envIdOf = (evidence: ClientEvidence, matched: string | undefined) =>
  matched ?? evidence.envId?.replace(/^env-/, "");

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
  if (looks4x(evidence)) return diagnoseWidgetNotVisible4x(evidence, pageUrl);

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
  let matchedEnvId: string | undefined;
  let matchedEnvName: string | undefined;

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
    matchedEnvId = text(env.winner?.env.id);
    matchedEnvName = env.winner?.name;
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

  const audience = audienceStep(
    evidence,
    envIdOf(evidence, matchedEnvId),
    matchedEnvName,
  );
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
