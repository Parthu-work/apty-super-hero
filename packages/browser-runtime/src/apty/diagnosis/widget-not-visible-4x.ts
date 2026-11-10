/**
 * Check pack for "the Apty widget is not showing" on a 4.x tenant (KB-RAG
 * K14, owner decision D-KB7), checked against apty-assist `player3.0` at
 * the commit in `FOUR_X_VERIFIED_ON` (K21 F4). Each rule names the player
 * code it mirrors; the paths are under `player3.0/src/`. Not runtime-verified.
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
  text,
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
  Params,
  RuleId,
  Verdict,
} from "./types.js";

/** The apty-assist commit and player version the 4.x rules were checked against. */
const FOUR_X_COMMIT = "bbb4cbc518a9b1c84055d33ba56822aa7d58ca17";
const FOUR_X_PLAYER_VERSION = "4.30.0";

export const FOUR_X_VERIFIED_ON = `4.x code, apty-assist ${FOUR_X_COMMIT.slice(0, 7)} (player ${FOUR_X_PLAYER_VERSION}); from code, not runtime-verified`;

/** A 4.x finding's confidence: the same as the 5.x rules, read from code. */
export const FOUR_X_CONFIDENCE = "likely";

export const WIDGET_FILES_4X = [
  "app-urls.json",
  "app-data.json",
  "feature-flag.json",
  "segments.json",
];

/** The environment `getEnvironment` falls back to when no pattern matches: production. */
const PRODUCTION_ENV = "1";

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

function finish(
  evidence: ClientEvidence,
  gates: GateResult[],
  verdict: Verdict,
): DiagnosisResult {
  return {
    packId: "widget-not-visible",
    cardPageId: CARD_4X["W4X-02"],
    verifiedOn: FOUR_X_VERIFIED_ON,
    aptyVersion: "4.x",
    subject: { kind: "widget", matched: [] },
    gates,
    verdict,
    confidence: verdict.status === "no_data" ? "unknown" : FOUR_X_CONFIDENCE,
    files: WIDGET_FILES_4X.map((name) => {
      const file = fileOf(evidence, name);
      return {
        name,
        status: file.status,
        ...(file.httpStatus !== undefined
          ? { httpStatus: file.httpStatus }
          : {}),
      };
    }),
    notChecked:
      verdict.status === "no_data"
        ? []
        : ["membership", "widget-css", "player-filters-4x"],
  };
}

const causeVerdict = (cause: Cause, nextCheck?: NextCheck): Verdict => ({
  status: "cause_found",
  headline: cause.summary,
  causes: [cause],
  ...(nextCheck ? { nextCheck } : {}),
});

/**
 * A feature flag's status: `feature-flag.json` is an object keyed by the
 * flag's camelCase name, each `{ key, status }`, merged over defaults that
 * are off (`main.bootstrap.ts:75-83`, `feature-flag.types.ts:50-53`). The
 * player tests `status` for truthiness.
 */
export function flagOn(flags: unknown, name: string): boolean {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return false;
  }
  const flag = (flags as Rec)[name];
  return Boolean(flag && typeof flag === "object" && (flag as Rec).status);
}

/**
 * The environment ids in the player's order: `Object.keys(...).map(Number)
 * .sort()` with no comparator, which sorts as text, so 10 comes before 2
 * (`app.helper.ts:81-87`).
 */
function environmentOrder(environments: unknown): string[] {
  if (!environments || typeof environments !== "object") return [];
  return Object.keys(environments)
    .map(Number)
    .map(String)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The 4.x `*` pattern (`url-helpers.ts:82-96`): every regular-expression
 * character but `*` is escaped, `*` matches any run of characters, and the
 * pattern may match anywhere in the full top-window address, case-sensitively.
 */
function starPatternMatches(pattern: string, pageUrl: string): boolean {
  const source = pattern
    .replace(/([.?+^$[\]\\(){}|/-])/g, "\\$1")
    .replace(/\*/g, ".*");
  return new RegExp(source).test(pageUrl);
}

interface Environment4x {
  app: Rec;
  envId: string;
  env: Rec;
  /** "Application: Environment", as the cause names it. */
  label: string;
}

const labelOf = (app: Rec, envId: string, env: Rec) =>
  `${text(app.name) ?? `application ${String(app.id ?? "?")}`}: ${text(env.name) ?? `environment ${envId}`}`;

type Pick =
  | { chosen: Environment4x }
  | { invalid: Environment4x & { pattern: string } }
  | { none: true };

/**
 * `getActiveApplication` (`injected.helpers.ts:18-49`): applications in
 * array order, each one's environments in `environmentOrder`; an
 * environment matches when, with the regex flag on, its `url` as a
 * `RegExp` matches the address, or else its `url` as a `*` pattern does.
 * The first match wins. A `url` that is not a valid regular expression
 * throws, and the whole search stops with no application.
 */
function pickEnvironment4x(
  appUrls: unknown,
  pageUrl: string,
  regexFlag: boolean,
): Pick {
  for (const app of records(appUrls)) {
    const environments = (app.environments ?? {}) as Rec;
    for (const envId of environmentOrder(environments)) {
      const env = environments[envId] as Rec | undefined;
      const url = text(env?.url);
      if (!env || !url) continue;
      const here = { app, envId, env, label: labelOf(app, envId, env) };
      if (regexFlag) {
        let matches: boolean;
        try {
          matches = new RegExp(url).test(pageUrl);
        } catch {
          return { invalid: { ...here, pattern: url } };
        }
        if (matches) return { chosen: here };
      }
      if (starPatternMatches(url, pageUrl)) return { chosen: here };
    }
  }
  return { none: true };
}

/** `getEnvironment` (`app.helper.ts:89-99`): the same walk over app-data.json's environments, else production. */
function appDataEnvironment(
  environments: Rec,
  pageUrl: string,
  regexFlag: boolean,
): string {
  for (const envId of environmentOrder(environments)) {
    const url = text((environments[envId] as Rec | undefined)?.url);
    if (!url) continue;
    let regexMatch = false;
    if (regexFlag) {
      try {
        regexMatch = new RegExp(url).test(pageUrl);
      } catch {
        regexMatch = false;
      }
    }
    if (regexMatch || starPatternMatches(url, pageUrl)) return envId;
  }
  return PRODUCTION_ENV;
}

const allEnvironments = (appUrls: unknown) =>
  records(appUrls)
    .map((app) => {
      const environments = (app.environments ?? {}) as Rec;
      return `${text(app.name) ?? `application ${String(app.id ?? "?")}`}: ${environmentOrder(
        environments,
      )
        .map(
          (envId) =>
            text((environments[envId] as Rec | undefined)?.name) ??
            `environment ${envId}`,
        )
        .join(", ")}`;
    })
    .join("; ");

const segmentNames = (evidence: ClientEvidence, ids: unknown) => {
  const segments = records(jsonOf(evidence, "segments.json"));
  return (Array.isArray(ids) ? ids : [])
    .map(
      (id) =>
        text(segments.find((s) => String(s.id) === String(id))?.name) ??
        `segment ${String(id)}`,
    )
    .join(", ");
};

export function diagnoseWidgetNotVisible4x(
  evidence: ClientEvidence,
  pageUrl?: string,
): DiagnosisResult {
  const appUrls = fileOf(evidence, "app-urls.json");
  if (appUrls.status === "http_error" || appUrls.status === "failed") {
    // api/http.ts:249-284: a network error, a 404 body or (injected build) any
    // non-2xx answer gives the empty-list fallback; either way no application.
    const cause: Cause = {
      ruleId: "W4X-01",
      cardPageId: CARD_4X["W4X-01"],
      params: { variant: "failed", httpStatus: appUrls.httpStatus ?? 0 },
      summary: `app-urls.json failed${appUrls.httpStatus ? ` (HTTP ${appUrls.httpStatus})` : ""}; the 4.x player finds no application in a failed answer, so the widget does not show.`,
      fix: "Fix the failing request (its status and the Console say why), then reload.",
      evidence: [
        `app-urls.json: ${appUrls.status}${appUrls.httpStatus ? ` (HTTP ${appUrls.httpStatus})` : ""}`,
      ],
    };
    return finish(
      evidence,
      [
        gate(
          "data",
          "fail",
          "W4X-01",
          "appUrlsFailed4x",
          cause.summary,
          cause.params,
          cause.evidence,
        ),
      ],
      causeVerdict(cause, "fixRequest"),
    );
  }
  if (appUrls.status === "empty") {
    // main.bootstrap.ts:162-171: no application, so the frame is hidden.
    const cause: Cause = {
      ruleId: "W4X-01",
      cardPageId: CARD_4X["W4X-01"],
      params: { variant: "empty", httpStatus: appUrls.httpStatus ?? 0 },
      summary:
        "app-urls.json is an empty list: no application is published for this tenant, so the widget does not show on any page.",
      fix: "In 4.x Admin, publish the application and its environments, then reload.",
      evidence: [`app-urls.json: [] (HTTP ${appUrls.httpStatus})`],
    };
    return finish(
      evidence,
      [
        gate(
          "data",
          "fail",
          "W4X-01",
          "appUrlsEmpty",
          cause.summary,
          cause.params,
          cause.evidence,
        ),
      ],
      causeVerdict(cause, "readStatus"),
    );
  }
  if (appUrls.status !== "ok") {
    const problem = FILE_PROBLEMS[appUrls.status];
    const data = gate(
      "data",
      "fail",
      "W4X-00",
      problem.reason,
      problem.text(appUrls),
      fileParams(appUrls),
    );
    const gates = [data];
    if (appUrls.status === "not_observed") {
      // main.bootstrap.ts:276-285: the snippet's data-app-urls list comes first.
      gates.push(
        gate(
          "data",
          "info",
          "W4X-00",
          "appUrlsFromSnippet4x",
          "The 4.x player fetches app-urls.json only when the page's Apty script tag has no data-app-urls list.",
        ),
      );
    }
    return finish(evidence, gates, {
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
      "W4X-00",
      "filesRead",
      `app-urls.json read (${records(appUrls.json).length} application(s)).`,
      { file: "app-urls.json", count: records(appUrls.json).length },
    ),
  ];
  if (!pageUrl || !/^https?:\/\//.test(pageUrl)) {
    gates.push(
      gate(
        "page",
        "unknown",
        "W4X-02",
        "pageUnknown",
        "No web page is open in this tab, so the environments' URL patterns were not checked.",
      ),
    );
    return finish(evidence, gates, {
      status: "candidates",
      headline:
        "No blocker for the widget in the files. Open the page where it is missing to check its environment.",
      causes: [],
      nextCheck: "openAppPage",
    });
  }
  gates.push(
    gate(
      "page",
      "pass",
      "W4X-02",
      "pageRead",
      "Checked against the page open in this tab.",
    ),
  );

  // feature-flag.types.ts:196-199: regExpUrl ({ key: "RegExpURL" }).
  const regexFlag = flagOn(jsonOf(evidence, "feature-flag.json"), "regExpUrl");
  const pick = pickEnvironment4x(appUrls.json, pageUrl, regexFlag);
  if ("invalid" in pick) {
    const bad = pick.invalid;
    const cause: Cause = {
      ruleId: "W4X-03",
      cardPageId: CARD_4X["W4X-03"],
      params: { env: bad.label, pattern: bad.pattern },
      summary: `${bad.label} has the URL "${bad.pattern}", which is not a valid regular expression; with the tenant's regex URL flag on, the 4.x player stops looking for the application there, so nothing loads on this page.`,
      fix: "In 4.x Admin, correct the environment's URL (or turn the regex URL flag off), publish and reload.",
      evidence: [
        `${bad.label}: url = ${bad.pattern}`,
        "feature-flag.json: regExpUrl.status on",
      ],
    };
    gates.push(
      gate(
        "environment-match",
        "fail",
        "W4X-03",
        "envRegexInvalid4x",
        cause.summary,
        cause.params,
        cause.evidence,
      ),
    );
    return finish(evidence, gates, causeVerdict(cause));
  }
  if ("none" in pick) {
    const envs = allEnvironments(appUrls.json);
    const cause: Cause = {
      ruleId: "W4X-02",
      cardPageId: CARD_4X["W4X-02"],
      params: { envs },
      summary:
        "No environment's URL pattern matches this page, so the 4.x player loads nothing here.",
      fix: "In 4.x Admin, give the right environment a URL that covers this page (a * covers any run of characters), publish and reload.",
      evidence: [`environments checked: ${envs}`, "matching patterns: 0"],
    };
    gates.push(
      gate(
        "environment-match",
        "fail",
        "W4X-02",
        "noEnvMatch",
        cause.summary,
        cause.params,
        cause.evidence,
      ),
    );
    return finish(evidence, gates, causeVerdict(cause));
  }
  const chosen = pick.chosen;
  gates.push(
    gate(
      "environment-match",
      "pass",
      "W4X-02",
      "envMatch",
      `This page belongs to ${chosen.label}.`,
      { env: chosen.label, order: 1 },
      [
        `first application with a matching environment, in the player's order: ${chosen.label}`,
      ],
    ),
  );

  const causes: Cause[] = [];
  const appDataFile = fileOf(evidence, "app-data.json");
  const data = jsonOf(evidence, "app-data.json");
  const appData =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Rec)
      : undefined;
  if (appDataFile.status !== "ok" && appDataFile.status !== "empty") {
    gates.push(
      gate(
        "widget-audience",
        "unknown",
        "W4X-04",
        "appDataUnread",
        "app-data.json was not read for this application, so whether the player and the widget are on is unknown.",
        { env: chosen.label },
      ),
    );
  } else if (
    !appData ||
    !appData.config ||
    typeof appData.config !== "object" ||
    !(appData.config as Rec).customConfig
  ) {
    // main.bootstrap.ts:306-326 reads config.customConfig.baseTag directly;
    // the outer catch (line 258) logs the error and the player never starts.
    causes.push({
      ruleId: "W4X-06",
      cardPageId: CARD_4X["W4X-06"],
      params: { env: chosen.label },
      summary:
        "app-data.json has no config.customConfig, so the 4.x player stops while it starts and the widget does not load.",
      fix: "In 4.x Admin, publish the application again so app-data.json is complete, then reload.",
      evidence: ["app-data.json: config.customConfig missing"],
    });
  } else {
    if (
      appData.id !== undefined &&
      String(appData.id) !== String(chosen.app.id)
    ) {
      gates.push(
        gate(
          "widget-audience",
          "unknown",
          "W4X-04",
          "appDataOtherApp4x",
          `The app-data.json read is for application ${String(appData.id)}, not ${String(chosen.app.id ?? "?")}.`,
          { app: String(appData.id) },
        ),
      );
    }
    const environments = (appData.environments ?? {}) as Rec;
    const envId = appDataEnvironment(environments, pageUrl, regexFlag);
    const env = environments[envId] as Rec | undefined;
    const envLabel = labelOf(chosen.app, envId, env ?? chosen.env);
    if (!env?.enablePlayer) {
      // app.helper.ts:101-108, index.tsx:300: enablePlayer must be truthy.
      causes.push({
        ruleId: "W4X-04",
        cardPageId: CARD_4X["W4X-04"],
        params: { env: envLabel },
        summary: `The player is not switched on for ${envLabel} (app-data.json enablePlayer is ${env ? String(env.enablePlayer) : "missing"}), so the widget does not show.`,
        fix: "In 4.x Admin, turn the player on for this environment, publish and reload.",
        evidence: [
          `app-data.json environments[${envId}].enablePlayer = ${env ? String(env.enablePlayer) : "(no such environment)"}`,
        ],
      });
    } else {
      widgetAudience(evidence, env, envLabel, envId, causes, gates);
    }
  }
  for (const cause of causes) {
    gates.push(
      gate(
        "widget-audience",
        "fail",
        cause.ruleId,
        cause.ruleId === "W4X-05"
          ? "widgetOff4x"
          : cause.ruleId === "W4X-06"
            ? "appDataIncomplete4x"
            : "playerOff4x",
        cause.summary,
        cause.params,
        cause.evidence,
      ),
    );
  }

  const open = gates.some((g) => g.status === "unknown");
  return finish(
    evidence,
    gates,
    causes.length > 0
      ? {
          status: "cause_found",
          headline: causes[0]?.summary ?? "",
          causes,
          ...(open ? { nextCheck: "openItems" as const } : {}),
        }
      : {
          status: open ? "candidates" : "no_cause_in_data",
          headline:
            "No blocker for the widget in the 4.x files. What is left is decided in the browser.",
          causes: [],
          nextCheck: open ? "openItems" : "sendSupport",
        },
  );
}

/**
 * `widgetConfig` (`app.selectors.ts:128-152`): none, or `display` "All",
 * shows the widget; "Specific" shows it to users of `selectedSegments`,
 * and to users of no segment when `enabledForOtherUser`; any other
 * `display` hides it.
 */
function widgetAudience(
  evidence: ClientEvidence,
  env: Rec,
  envLabel: string,
  envId: string,
  causes: Cause[],
  gates: GateResult[],
): void {
  const config = env.widgetConfig as Rec | undefined;
  if (!config || config.display === "All") {
    gates.push(
      gate(
        "widget-audience",
        "pass",
        "W4X-05",
        "widgetForAll4x",
        `The widget is shown to every user of ${envLabel}.`,
        { env: envLabel },
      ),
    );
    return;
  }
  const where = `app-data.json environments[${envId}].widgetConfig`;
  if (config.display !== "Specific") {
    causes.push({
      ruleId: "W4X-05",
      cardPageId: CARD_4X["W4X-05"],
      params: {
        env: envLabel,
        variant: "display",
        display: String(config.display),
      },
      summary: `The widget's audience for ${envLabel} is "${String(config.display)}", which the 4.x player does not show.`,
      fix: "In 4.x Admin, set who sees the widget (all users or selected segments), publish and reload.",
      evidence: [`${where}.display = ${String(config.display)}`],
    });
    return;
  }
  const selected = Array.isArray(config.selectedSegments)
    ? config.selectedSegments
    : [];
  const others = Boolean(config.enabledForOtherUser);
  if (selected.length === 0 && !others) {
    causes.push({
      ruleId: "W4X-05",
      cardPageId: CARD_4X["W4X-05"],
      params: { env: envLabel, variant: "nobody" },
      summary: `The widget for ${envLabel} is limited to selected segments, but none is selected and users outside segments are left out, so nobody sees it.`,
      fix: "In 4.x Admin, select the segments that should see the widget, or show it to all users, publish and reload.",
      evidence: [
        `${where}.display = Specific`,
        `${where}.selectedSegments = []`,
        `${where}.enabledForOtherUser = false`,
      ],
    });
    return;
  }
  const segments = segmentNames(evidence, selected);
  gates.push(
    gate(
      "widget-audience",
      "unknown",
      "W4X-05",
      others ? "widgetSegmentsOrNone4x" : "widgetSegments4x",
      others
        ? `The widget is shown to users of ${segments || "no selected segment"}, and to users who match no segment; whether this user does is decided in the browser.`
        : `The widget is shown only to users of ${segments}; whether this user is one is decided in the browser.`,
      { env: envLabel, segments },
    ),
  );
}
