/**
 * Check pack for "my <content> is not visible in the widget", from the RAG
 * card "workflow is not showing in the widget" (JA 1496842241) and the
 * segmentation reference behind it (JA 1477640228, 1477836862). Every rule
 * here is from 5.x code at 4c406d5, not runtime-verified, so a finding is
 * never more certain than "likely".
 *
 * The gates run in the card's order and only read: publication in this
 * environment, the item's own settings, its segments, the widget's audience
 * and its visibility rule. What only the browser can decide (whether this
 * user matches a segment's rule, a visibility rule's result) is reported as
 * candidates, never guessed.
 */
import { languageName } from "./languages.js";
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
  type ScanRow,
  type Verdict,
} from "./types.js";

export const CARD_PAGE_ID = "1496842241";
const CARD_SEGMENTS = "1496645671";
const CARD_SEGMENT_OFF = "1496612886";
const CARD_WIDGET_AUDIENCE = "1496645745";
const CARD_LANGUAGE = "1496678461";
export const VERIFIED_ON =
  "5.x code, commit 4c406d5, 2026-09-22; from code, not runtime-verified";

const NOT_CHECKED: NotChecked[] = ["membership", "runtime-rules"];

export function filesFor(kind: ContentKind): string[] {
  return [
    KINDS[kind].file,
    "segment.json",
    "rule.json",
    "app-urls.json",
    "app-data.json",
  ];
}

/** The names an item shows, from its own `name` and each locale's `name`. */
function namesOf(item: Rec): string[] {
  const own = text(item.name);
  const localized = records(item.locales).flatMap((l) => {
    const name = text(l.name);
    return name ? [name] : [];
  });
  return [...new Set([...(own ? [own] : []), ...localized])];
}

const labelOf = (item: Rec) => namesOf(item)[0] ?? "(unnamed)";

function gate(
  id: GateId,
  status: GateStatus,
  ruleId: RuleId,
  reason: GateReason,
  detail: string,
  params: Params = {},
  evidence: string[] = [],
  cardPageId = CARD_PAGE_ID,
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

interface Draft {
  kind: ContentKind;
  query?: string;
  language?: string;
  evidence: ClientEvidence;
}

function finish(
  draft: Draft,
  gates: GateResult[],
  verdict: Verdict,
  extra: Partial<
    Pick<DiagnosisResult, "confidence" | "scan" | "notChecked">
  > & { matched?: string[]; name?: string } = {},
): DiagnosisResult {
  return {
    packId: "content-not-visible",
    cardPageId: CARD_PAGE_ID,
    verifiedOn: VERIFIED_ON,
    subject: {
      kind: draft.kind,
      ...(draft.query ? { query: draft.query } : {}),
      ...(draft.language ? { language: draft.language } : {}),
      ...(extra.name ? { name: extra.name } : {}),
      matched: extra.matched ?? [],
    },
    gates,
    verdict,
    confidence: extra.confidence ?? "unknown",
    files: filesFor(draft.kind).map((name) => {
      const file = fileOf(draft.evidence, name);
      return {
        name,
        status: file.status,
        ...(file.httpStatus !== undefined
          ? { httpStatus: file.httpStatus }
          : {}),
      };
    }),
    notChecked: extra.notChecked ?? [],
    ...(extra.scan ? { scan: extra.scan } : {}),
  };
}

function noData(draft: Draft, data: GateResult, next: NextCheck) {
  return finish(draft, [data], {
    status: "no_data",
    headline: data.detail,
    causes: [],
    nextCheck: next,
  });
}

function environmentGate(evidence: ClientEvidence): GateResult {
  const envKey = evidence.envId?.replace(/^env-/, "");
  const env = records(jsonOf(evidence, "app-urls.json"))
    .flatMap((app) => records(app.environments))
    .find((e) => e.id === envKey);
  if (!env) {
    return gate(
      "environment",
      "unknown",
      "CNV-01",
      "envUnknown",
      "The environment in the content files' path is not in app-urls.json, or app-urls.json was not read.",
    );
  }
  const name = text(env.name) ?? "(unnamed)";
  return gate(
    "environment",
    "info",
    "CNV-01",
    "envLoaded",
    `The Apty Client loaded the ${name} environment (order ${String(env.order)}).`,
    { env: name, order: String(env.order) },
    [`env id ${short(envKey ?? "")} = ${name} in app-urls.json`],
  );
}

function resolveItems(items: Rec[], query: string): Rec[] {
  const wanted = query.trim().toLowerCase();
  const byId = items.filter(
    (i) => text(i.sourceId) === query.trim() || text(i.id) === query.trim(),
  );
  if (byId.length > 0) return byId;
  const exact = items.filter((i) =>
    namesOf(i).some((n) => n.trim().toLowerCase() === wanted),
  );
  if (exact.length > 0) return exact;
  return items.filter((i) =>
    namesOf(i).some((n) => n.toLowerCase().includes(wanted)),
  );
}

function scan(
  draft: Draft,
  items: Rec[],
  segments: Rec[],
  gates: GateResult[],
) {
  const spec = KINDS[draft.kind];
  const rows: ScanRow[] = items.map((item) => {
    const sourceId = text(item.sourceId) ?? "";
    const blockers: ScanRow["blockers"] = [];
    if (item.hideFromWidget === true) blockers.push("hidden");
    if (namesOf(item).length === 0) blockers.push("no-name");
    const linked = segments.filter((s) =>
      texts(s[spec.segmentField]).includes(sourceId),
    );
    if (linked.length > 0 && linked.every((s) => s.isActive !== true)) {
      blockers.push("inactive-segments");
    }
    return { name: labelOf(item), sourceId, blockers };
  });
  const blocked = rows.filter((r) => r.blockers.length > 0).length;
  return finish(
    draft,
    gates,
    {
      status: blocked > 0 ? "candidates" : "no_cause_in_data",
      headline: `${blocked} of ${rows.length} ${spec.label}s have a blocker in the files. Name the one that is missing to check it in full.`,
      causes: [],
      nextCheck: "nameItem",
    },
    {
      confidence: "likely",
      notChecked: NOT_CHECKED,
      scan: { total: rows.length, rows },
    },
  );
}

function notPublished(
  draft: Draft,
  items: Rec[],
  segments: Rec[],
  gates: GateResult[],
) {
  const spec = KINDS[draft.kind];
  const query = draft.query ?? "";
  const listed = new Set(segments.flatMap((s) => texts(s[spec.segmentField])));
  const present = new Set(items.map((i) => text(i.sourceId)));
  const dangling = [...listed].filter((id) => !present.has(id));
  const linkedButMissing =
    listed.has(query.trim()) && !present.has(query.trim());
  const cause: Cause = {
    ruleId: "CNV-02",
    cardPageId: CARD_PAGE_ID,
    params: { kind: spec.label, name: query, file: spec.file },
    summary: `No ${spec.label} matching "${query}" is in ${spec.file} for this environment, so it is not published here.`,
    fix: `Publish the ${spec.label} to the environment the user is on; each environment has its own published content. If the name is spelled differently, give the exact name or its sourceId.`,
    evidence: [
      `${spec.file}: ${items.length} entries, none match "${query}"`,
      ...(linkedButMissing
        ? [`segment.json still lists sourceId ${short(query.trim())}`]
        : []),
      ...(dangling.length > 0
        ? [
            `${dangling.length} ${spec.label} ID(s) listed in segment.json are not in ${spec.file}`,
          ]
        : []),
    ],
  };
  gates.push(
    gate(
      "published",
      "fail",
      "CNV-02",
      "notPublished",
      cause.summary,
      cause.params,
      cause.evidence,
    ),
  );
  return finish(
    draft,
    gates,
    {
      status: "cause_found",
      headline: cause.summary,
      causes: [cause],
      nextCheck: "reload",
    },
    { confidence: "likely", notChecked: NOT_CHECKED },
  );
}

function flagCauses(kind: ContentKind, item: Rec): Cause[] {
  const spec = KINDS[kind];
  const name = labelOf(item);
  const causes: Cause[] = [];
  if (item.hideFromWidget === true) {
    causes.push({
      ruleId: "CNV-03",
      cardPageId: CARD_PAGE_ID,
      params: { kind: spec.label, name },
      summary: `"Hide from widget" is on for "${name}", so the widget list does not show it.`,
      fix: `In Studio, clear "Hide from widget" in the ${spec.label}'s settings and publish.`,
      evidence: [`${spec.file}: hideFromWidget = true`],
    });
  }
  if (namesOf(item).length === 0) {
    causes.push({
      ruleId: "CNV-04",
      cardPageId: CARD_PAGE_ID,
      params: { kind: spec.label, name },
      summary: `This ${spec.label} has no name in any language, so the widget list drops it.`,
      fix: "Give it a name in the user's language and publish.",
      evidence: [`${spec.file}: no name and no locales[].name`],
    });
  }
  if (kind === "workflow") {
    for (const [flag, field] of [
      ["enableSuccess", "successMessage"],
      ["enableFeedback", "feedbackMessage"],
    ] as const) {
      if (item[flag] !== true) continue;
      const blank = records(item.locales).filter((l) => !text(l[field]));
      if (blank.length === 0) continue;
      const languages = blank.map((l) => String(l.locale)).join(", ");
      causes.push({
        ruleId: "CNV-05",
        cardPageId: CARD_PAGE_ID,
        params: { kind: spec.label, name, field, languages },
        summary: `${flag} is on but ${field} is empty for ${languages}, which drops "${name}" from the list in that language.`,
        fix: `Add the ${field} in that language, or turn ${flag} off, and publish.`,
        evidence: blank.map(
          (l) => `locale ${String(l.locale)}: ${field} is empty`,
        ),
      });
    }
  }
  return causes;
}

function segmentGate(
  draft: Draft,
  item: Rec,
  segments: Rec[] | undefined,
  rules: Rec[] | undefined,
): { gate: GateResult; cause?: Cause; linked: Rec[]; usable: Rec[] } {
  const spec = KINDS[draft.kind];
  const sourceId = text(item.sourceId) ?? "";
  if (!segments) {
    const file = fileOf(draft.evidence, "segment.json");
    return {
      linked: [],
      usable: [],
      gate: gate(
        "segments",
        "unknown",
        "CNV-09",
        "segmentsUnread",
        `segment.json could not be read (${file.status}).`,
        { status: file.status },
        [],
        CARD_SEGMENTS,
      ),
    };
  }
  const linked = segments.filter((s) =>
    texts(s[spec.segmentField]).includes(sourceId),
  );
  if (linked.length === 0) {
    return {
      linked,
      usable: [],
      gate: gate(
        "segments",
        "pass",
        "CNV-06",
        "noSegments",
        `No segment lists this ${spec.label}, so it is visible to every user.`,
        { kind: spec.label },
        [
          `segment.json: ${segments.length} segments, none list ${short(sourceId)}`,
        ],
        CARD_SEGMENTS,
      ),
    };
  }
  const ruleIds = new Set(rules?.map((r) => text(r.id)));
  const ruleOk = (s: Rec) => rules === undefined || ruleIds.has(text(s.ruleId));
  const lines = linked.map(
    (s) =>
      `${text(s.name) ?? "(unnamed)"}: isActive ${String(s.isActive)}, rule ${
        rules === undefined ? "not read" : ruleOk(s) ? "present" : "missing"
      } in rule.json`,
  );
  const names = (list: Rec[]) =>
    list.map((s) => text(s.name) ?? "(unnamed)").join(", ");
  const live = linked.filter((s) => s.isActive === true);
  if (live.length === 0) {
    const cause: Cause = {
      ruleId: "CNV-07",
      cardPageId: CARD_SEGMENT_OFF,
      params: { kind: spec.label, segments: names(linked) },
      summary: `Every segment that lists this ${spec.label} (${names(linked)}) is turned off, so it can never match and the ${spec.label} is hidden from everyone.`,
      fix: "Turn one of these segments on, or remove the item from them, and publish.",
      evidence: lines,
    };
    return {
      linked,
      usable: [],
      cause,
      gate: gate(
        "segments",
        "fail",
        "CNV-07",
        "allInactive",
        cause.summary,
        cause.params,
        lines,
        CARD_SEGMENT_OFF,
      ),
    };
  }
  const usable = live.filter(ruleOk);
  if (usable.length === 0) {
    const cause: Cause = {
      ruleId: "CNV-08",
      cardPageId: CARD_SEGMENTS,
      params: { kind: spec.label, segments: names(live) },
      summary: `The rules of the active segments that list this ${spec.label} (${names(live)}) are missing from rule.json, so those segments never match.`,
      fix: "Open each segment in Studio, save it with a rule, and publish.",
      evidence: lines,
    };
    return {
      linked,
      usable: [],
      cause,
      gate: gate(
        "segments",
        "fail",
        "CNV-08",
        "rulesMissing",
        cause.summary,
        cause.params,
        lines,
        CARD_SEGMENTS,
      ),
    };
  }
  return {
    linked,
    usable,
    gate: gate(
      "segments",
      "unknown",
      "CNV-09",
      "mustMatch",
      `The user must match the rule of at least one of these active segments: ${names(usable)}. Only the browser can tell.`,
      { segments: names(usable) },
      lines,
      CARD_SEGMENTS,
    ),
  };
}

function consistencyGate(item: Rec, linked: Rec[]): GateResult | undefined {
  const own = texts(item.segmentIds);
  const oneSided = own.filter((id) => !linked.some((s) => s.id === id));
  if (oneSided.length === 0) return undefined;
  return gate(
    "segment-consistency",
    "info",
    "CNV-10",
    "oneSided",
    `The item lists ${oneSided.length} segment(s) that do not list it back. The widget follows segment.json.`,
    { count: oneSided.length },
    oneSided.map(
      (id) => `segmentIds has ${short(id)}, which does not list the item`,
    ),
    CARD_SEGMENTS,
  );
}

/**
 * The widget's own audience. A user must be in one of the widget's segments
 * and, for an item with segments, in one of the item's: when the two lists
 * differ, only a user in both sees it, which the files cannot tell (P4).
 */
function widgetGate(draft: Draft, segments: Rec[], usable: Rec[]): GateResult {
  const spec = KINDS[draft.kind];
  const appData = jsonOf(draft.evidence, "app-data.json") as Rec | undefined;
  const config = appData?.config as Rec | undefined;
  const widgetConfig = config?.widgetConfig as Rec | undefined;
  if (!widgetConfig) {
    return gate(
      "widget-audience",
      "unknown",
      "CNV-11",
      "appDataUnread",
      "app-data.json was not read, so the widget's own audience is unknown.",
      {},
      [],
      CARD_WIDGET_AUDIENCE,
    );
  }
  const patterns = Array.isArray(widgetConfig.restrictionPatterns)
    ? widgetConfig.restrictionPatterns.length
    : 0;
  const lines = [
    `app-data.json: widgetConfig.display = ${String(widgetConfig.display)}`,
    ...(patterns > 0 ? [`${patterns} restriction pattern(s) set`] : []),
  ];
  if (widgetConfig.display !== "Specific") {
    return gate(
      "widget-audience",
      "pass",
      "CNV-11",
      "widgetForAll",
      `The widget is not limited to selected segments (display ${String(widgetConfig.display)}).`,
      { display: String(widgetConfig.display) },
      lines,
      CARD_WIDGET_AUDIENCE,
    );
  }
  const selected = texts(widgetConfig.selectedSegments);
  const selectedNames =
    segments
      .filter((s) => selected.includes(text(s.id) ?? ""))
      .map((s) => text(s.name) ?? "(unnamed)")
      .join(", ") || `${selected.length} segment(s) not in segment.json`;
  const overlap = usable.some((s) => selected.includes(text(s.id) ?? ""));
  if (usable.length > 0 && !overlap) {
    const itemSegments = usable
      .map((s) => text(s.name) ?? "(unnamed)")
      .join(", ");
    return gate(
      "widget-audience",
      "unknown",
      "CNV-11",
      "widgetDisjoint",
      `The widget is shown only to the segments ${selectedNames}, while this ${spec.label} is for ${itemSegments}: only a user in both sees it.`,
      { segments: selectedNames, itemSegments },
      [
        ...lines,
        `widget segments: ${selectedNames}`,
        `item segments: ${itemSegments}`,
      ],
      CARD_WIDGET_AUDIENCE,
    );
  }
  return gate(
    "widget-audience",
    "unknown",
    "CNV-11",
    "widgetLimited",
    `The widget itself is shown only to the segments ${selectedNames}; the user must be in one of them.`,
    { segments: selectedNames },
    lines,
    CARD_WIDGET_AUDIENCE,
  );
}

/**
 * The item's name in the language the message named (JA 1496678461): the
 * widget drops an item with no name in the user's language, and a regional
 * entry such as fr-CA does not stand in for fr.
 */
function languageGate(
  draft: Draft,
  item: Rec,
): { gate: GateResult; cause?: Cause } {
  const code = draft.language ?? "";
  const language = languageName(code);
  const named = records(item.locales)
    .filter((l) => text(l.name))
    .map((l) => String(l.locale));
  const forLanguage = named.filter(
    (l) => l.toLowerCase().split(/[-_]/)[0] === code,
  );
  const lines = [
    `${KINDS[draft.kind].file}: names in ${named.join(", ") || "no language"}`,
  ];
  const params = { language, code };
  if (forLanguage.length === 0) {
    const cause: Cause = {
      ruleId: "CNV-13",
      cardPageId: CARD_LANGUAGE,
      params: { ...params, name: labelOf(item) },
      summary: `"${labelOf(item)}" has no name in ${language} (${code}), so the widget drops it for ${language} users.`,
      fix: `In Studio, add and publish the ${language} translation: its name, and the success and feedback messages if they are on.`,
      evidence: lines,
    };
    return {
      gate: gate(
        "language",
        "fail",
        "CNV-13",
        "localeMissing",
        cause.summary,
        params,
        lines,
        CARD_LANGUAGE,
      ),
      cause,
    };
  }
  if (!forLanguage.some((l) => l.toLowerCase() === code)) {
    return {
      gate: gate(
        "language",
        "unknown",
        "CNV-13",
        "localeRegional",
        `"${labelOf(item)}" is named in ${forLanguage.join(", ")} only: a user whose language code is ${code} gets none of them, as a regional entry does not fall back.`,
        { ...params, locales: forLanguage.join(", ") },
        lines,
        CARD_LANGUAGE,
      ),
    };
  }
  return {
    gate: gate(
      "language",
      "pass",
      "CNV-13",
      "localeFound",
      `"${labelOf(item)}" has a name in ${language} (${forLanguage.join(", ")}).`,
      { ...params, locales: forLanguage.join(", ") },
      lines,
      CARD_LANGUAGE,
    ),
  };
}

function visibilityGate(item: Rec, rules: Rec[] | undefined): GateResult {
  const ruleId = text(item.visibilityRuleId);
  if (!ruleId) {
    return gate(
      "visibility-rule",
      "pass",
      "CNV-12",
      "noVisibilityRule",
      "No visibility rule.",
    );
  }
  const rule = rules?.find((r) => r.id === ruleId);
  const name = text(rule?.name) ?? short(ruleId);
  const action = String(item.visibilityRuleAction ?? "SHOW");
  return gate(
    "visibility-rule",
    "unknown",
    "CNV-12",
    "visibilityRule",
    `The visibility rule "${name}" (${action}) is evaluated in the browser.`,
    { rule: name, action },
    text(rule?.summary) ? [`rule summary: ${text(rule?.summary)}`] : [],
  );
}

/**
 * Runs the pack on what the loader read. With no query, every item of the
 * kind is scanned for the blockers the files show; with one, the item is
 * resolved by sourceId, exact name, then partial name.
 */
export function diagnoseContentNotVisible(
  evidence: ClientEvidence,
  kind: ContentKind,
  query?: string,
  language?: string,
): DiagnosisResult {
  const spec = KINDS[kind];
  const draft: Draft = {
    kind,
    query: query?.trim() || undefined,
    language,
    evidence,
  };

  if (!evidence.connection.ok) {
    const { message } = evidence.connection;
    return noData(
      draft,
      gate(
        "data",
        "fail",
        "CNV-00",
        "clientUnreachable",
        `Could not reach the Apty Client: ${message}`,
        { message },
      ),
      "fixConnection",
    );
  }
  if (looks4x(evidence)) {
    return finish(
      draft,
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

  const kindFile = fileOf(evidence, spec.file);
  if (kindFile.status !== "ok") {
    const problem = FILE_PROBLEMS[kindFile.status];
    return noData(
      draft,
      gate(
        "data",
        "fail",
        "CNV-00",
        problem.reason,
        problem.text(kindFile),
        fileParams(kindFile),
      ),
      problem.nextCheck,
    );
  }

  const items = records(kindFile.json);
  const segmentFile = fileOf(evidence, "segment.json");
  const segments =
    segmentFile.status === "ok" ? records(segmentFile.json) : undefined;
  const ruleFile = fileOf(evidence, "rule.json");
  const rules = ruleFile.status === "ok" ? records(ruleFile.json) : undefined;

  const gates: GateResult[] = [
    gate(
      "data",
      "pass",
      "CNV-00",
      "filesRead",
      `${spec.file} read (${items.length} entries).`,
      { file: spec.file, count: items.length },
      filesFor(kind).map((name) => {
        const file = fileOf(evidence, name);
        return `${name}: ${file.status}${file.httpStatus ? ` (HTTP ${file.httpStatus})` : ""}`;
      }),
    ),
    environmentGate(evidence),
  ];

  if (!draft.query) return scan(draft, items, segments ?? [], gates);

  const matches = resolveItems(items, draft.query);
  if (matches.length === 0) {
    return notPublished(draft, items, segments ?? [], gates);
  }
  if (matches.length > 1) {
    const candidates = matches.map(
      (m) => `${labelOf(m)} (${short(text(m.sourceId) ?? "")})`,
    );
    gates.push(
      gate(
        "published",
        "unknown",
        "CNV-02",
        "severalMatch",
        `${matches.length} ${spec.label}s match "${draft.query}".`,
        { count: matches.length, name: draft.query },
        candidates,
      ),
    );
    return finish(
      draft,
      gates,
      {
        status: "candidates",
        headline: `${matches.length} ${spec.label}s match "${draft.query}". Which one is missing?`,
        causes: [],
        nextCheck: "whichOne",
      },
      { matched: candidates },
    );
  }

  const item = matches[0] as Rec;
  const sourceId = text(item.sourceId) ?? "";
  const label = labelOf(item);
  const causes: Cause[] = [];
  gates.push(
    gate(
      "published",
      "pass",
      "CNV-02",
      "found",
      `"${label}" is in ${spec.file} for this environment.`,
      { name: label, file: spec.file },
      [`${label} (${short(sourceId)}), version ${String(item.versionNumber)}`],
    ),
  );

  const flags = flagCauses(kind, item);
  causes.push(...flags);
  gates.push(
    flags.length > 0
      ? gate(
          "flags",
          "fail",
          flags[0]?.ruleId ?? "CNV-03",
          "flagsFail",
          flags.map((c) => c.summary).join(" "),
          { count: flags.length },
          flags.flatMap((c) => c.evidence),
        )
      : gate(
          "flags",
          "pass",
          "CNV-03",
          "flagsOk",
          "Not hidden from the widget, and it has a name.",
          {
            languages: records(item.locales)
              .map((l) => String(l.locale))
              .join(", "),
          },
        ),
  );

  if (draft.language) {
    const language = languageGate(draft, item);
    gates.push(language.gate);
    if (language.cause) causes.push(language.cause);
  }

  const segment = segmentGate(draft, item, segments, rules);
  gates.push(segment.gate);
  if (segment.cause) causes.push(segment.cause);
  const consistency = consistencyGate(item, segment.linked);
  if (consistency) gates.push(consistency);

  gates.push(widgetGate(draft, segments ?? [], segment.usable));

  gates.push(visibilityGate(item, rules));

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
            headline: `No blocker in the files for "${label}". What is left is decided in the browser.`,
            causes: [],
            nextCheck: "testAsMember",
          }
        : {
            status: "no_cause_in_data",
            headline: `No cause in the files for "${label}".`,
            causes: [],
            nextCheck: "sendSupport",
          };

  return finish(draft, gates, verdict, {
    confidence: "likely",
    notChecked: NOT_CHECKED,
    matched: [`${label} (${short(sourceId)})`],
    name: label,
  });
}
