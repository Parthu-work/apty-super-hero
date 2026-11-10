/**
 * Check pack for "the Apty widget is not showing" on a 4.x tenant (KB-RAG
 * K14, owner decision D-KB7). Ported from the 4.x player's behaviour as
 * FIXES.md K14 describes it; apty-assist was not readable where this was
 * written, so each apty-assist file and line below is FIXES.md's, still to
 * be checked against a pinned commit (docs/STATUS.md). Every finding says
 * so, and none is more certain than "possible": one step below the 5.x
 * rules, which were read from code (K21 F4).
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
  Params,
  RuleId,
  Verdict,
} from "./types.js";
import { patternMatches } from "./url-patterns.js";

export const FOUR_X_VERIFIED_ON =
  "4.x behaviour as described in FIXES.md K14, not yet checked against apty-assist code; not runtime-verified";

/** A 4.x finding's confidence: one step below the 5.x rules' "likely", until a commit is pinned. */
export const FOUR_X_CONFIDENCE = "possible";

export const WIDGET_FILES_4X = [
  "app-urls.json",
  "app-data.json",
  "feature-flag.json",
];

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
        : ["membership", "runtime-rules", "widget-css"],
  };
}

const causeVerdict = (cause: Cause, nextCheck?: NextCheck): Verdict => ({
  status: "cause_found",
  headline: cause.summary,
  causes: [cause],
  ...(nextCheck ? { nextCheck } : {}),
});

/**
 * Whether the tenant's regex URL flag is on. The 4.x player fetches its
 * feature flags per tenant (apty-assist `feature-flag.effects.ts`); the
 * file is read as a list of `{ key | name, enabled | value }` or as an
 * object of flags.
 */
function regexFlagOn(flags: unknown): boolean {
  const names = new Set(["urlRegex", "regExpUrl", "regexUrl"]);
  if (Array.isArray(flags)) {
    return records(flags).some(
      (flag) =>
        names.has(String(flag.key ?? flag.name)) &&
        (flag.enabled === true || flag.value === true),
    );
  }
  const record = (flags ?? {}) as Rec;
  return [...names].some((name) => record[name] === true);
}

interface Environment4x {
  app: Rec;
  env: Rec;
  /** "Application: Environment", as the cause names it. */
  label: string;
}

const labelOf = (app: Rec, env: Rec) =>
  `${text(app.name) ?? text(String(app.id ?? "")) ?? "(unnamed)"}: ${text(env.name) ?? "(unnamed)"}`;

/**
 * The 4.x pick (apty-assist `player3.0/src/shared/helpers/cdn-helpers.ts`,
 * which reads app-urls.json, line 17 per FIXES.md, to be confirmed):
 * applications in file order, the first with an environment whose URL
 * pattern matches the full top-window address wins. A `*` matches any run
 * of characters, every other character matches itself, and the pattern may
 * match anywhere in the address. With the regex URL flag on, a pattern is
 * also tried as a regular expression; one that is not valid is reported,
 * not thrown.
 */
function pickEnvironment4x(
  appUrls: unknown,
  pageUrl: string,
  regexFlag: boolean,
): {
  chosen?: Environment4x;
  invalid: Array<Environment4x & { pattern: string }>;
} {
  const invalid: Array<Environment4x & { pattern: string }> = [];
  for (const app of records(appUrls)) {
    for (const env of records(app.environments)) {
      for (const pattern of texts(env.urls)) {
        const here = { app, env, label: labelOf(app, env) };
        if (regexFlag) {
          try {
            if (new RegExp(pattern).test(pageUrl))
              return { chosen: here, invalid };
          } catch {
            invalid.push({ ...here, pattern });
          }
        }
        if (patternMatches(pattern, pageUrl)) return { chosen: here, invalid };
      }
    }
  }
  return { invalid };
}

const allEnvironments = (appUrls: unknown) =>
  records(appUrls)
    .map(
      (app) =>
        `${text(app.name) ?? "(unnamed)"}: ${records(app.environments)
          .map((env) => text(env.name) ?? "(unnamed)")
          .join(", ")}`,
    )
    .join("; ");

/** The app-data.json entry of an environment: by `environmentId`, or the whole file when it names none. */
function appDataFor(appData: unknown, env: Rec): Rec | undefined {
  const list = records(appData);
  if (list.length === 0) {
    return appData && typeof appData === "object"
      ? (appData as Rec)
      : undefined;
  }
  return list.find(
    (entry) => String(entry.environmentId ?? entry.envId) === String(env.id),
  );
}

export function diagnoseWidgetNotVisible4x(
  evidence: ClientEvidence,
  pageUrl?: string,
): DiagnosisResult {
  const appUrls = fileOf(evidence, "app-urls.json");
  if (appUrls.status === "http_error" || appUrls.status === "failed") {
    // apty-assist player3.0/src/api/http.ts (line 249 per FIXES.md, to be
    // confirmed): a failed content request resolves to an empty list.
    const cause: Cause = {
      ruleId: "W4X-01",
      cardPageId: CARD_4X["W4X-01"],
      params: { variant: "failed", httpStatus: appUrls.httpStatus ?? 0 },
      summary: `app-urls.json failed${appUrls.httpStatus ? ` (HTTP ${appUrls.httpStatus})` : ""}; the 4.x player reads a failed request as an empty list, so no application loads and the widget does not show.`,
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

  const regexFlag = regexFlagOn(jsonOf(evidence, "feature-flag.json"));
  const { chosen, invalid } = pickEnvironment4x(
    appUrls.json,
    pageUrl,
    regexFlag,
  );
  for (const bad of invalid) {
    gates.push(
      gate(
        "environment-match",
        "unknown",
        "W4X-03",
        "envRegexInvalid4x",
        `${bad.label} has the URL pattern "${bad.pattern}", which is not a valid regular expression; the tenant's regex URL flag is on, so the player cannot read it as one.`,
        { env: bad.label, pattern: bad.pattern },
      ),
    );
  }
  if (!chosen) {
    const envs = allEnvironments(appUrls.json);
    const cause: Cause = {
      ruleId: "W4X-02",
      cardPageId: CARD_4X["W4X-02"],
      params: { envs },
      summary:
        "No environment's URL pattern matches this page, so the 4.x player loads nothing here.",
      fix: "In 4.x Admin, add a URL pattern that covers this page (a * covers any run of characters) to the right environment, publish and reload.",
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
  gates.push(
    gate(
      "environment-match",
      "pass",
      "W4X-02",
      "envMatch",
      `This page belongs to ${chosen.label}.`,
      { env: chosen.label, order: 1 },
      [
        `first application in file order with a matching environment: ${chosen.label}`,
      ],
    ),
  );

  // apty-assist player3.0/src/shared/helpers/cdn-helpers.ts reads
  // app-data.json (line 23 per FIXES.md, to be confirmed).
  const data = appDataFor(jsonOf(evidence, "app-data.json"), chosen.env);
  const causes: Cause[] = [];
  if (!data) {
    gates.push(
      gate(
        "widget-audience",
        "unknown",
        "W4X-04",
        "appDataUnread",
        "app-data.json was not read for this environment, so whether the player and the widget are on is unknown.",
        { env: chosen.label },
      ),
    );
  } else {
    if (data.enablePlayer === false) {
      causes.push({
        ruleId: "W4X-04",
        cardPageId: CARD_4X["W4X-04"],
        params: { env: chosen.label },
        summary: `The player is switched off for ${chosen.label} (app-data.json enablePlayer is false), so nothing from Apty runs on this page.`,
        fix: "In 4.x Admin, turn the player on for this environment, publish and reload.",
        evidence: ["app-data.json: enablePlayer = false"],
      });
    }
    const widget = (data.widgetConfig ?? {}) as Rec;
    if (widget.enabled === false || widget.enableWidget === false) {
      causes.push({
        ruleId: "W4X-05",
        cardPageId: CARD_4X["W4X-05"],
        params: { env: chosen.label },
        summary: `The widget is switched off for ${chosen.label} (app-data.json widgetConfig), so it does not show although the player runs.`,
        fix: "In 4.x Admin, turn the widget on for this environment, publish and reload.",
        evidence: ["app-data.json: widgetConfig.enabled = false"],
      });
    }
    for (const cause of causes) {
      gates.push(
        gate(
          "widget-audience",
          "fail",
          cause.ruleId,
          cause.ruleId === "W4X-04" ? "playerOff4x" : "widgetOff4x",
          cause.summary,
          cause.params,
          cause.evidence,
        ),
      );
    }
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
