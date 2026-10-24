/**
 * Ignore rules from classified items (R1.5, D7). Every rule is a list of
 * conditions combined with ALL; a literal taken from page data must pass
 * the D3 check or the rule is not emitted and the attribute goes to manual
 * review without its values. A rule that would also match a value seen
 * unchanged in every run of a page is rejected, with the reason. Rules are
 * deduplicated across pages and compacted where the union is exact.
 */
import { DEFAULT_IGNORE, fnv1a } from "@apty/dom-snapshot";
import type { ClassifiedItem, ClassifiedPage, RecordKind } from "./classify.js";
import { DOM_CONFIG_LIMITS } from "./limits.js";
import {
  anchored,
  compileRuleRegex,
  escapeRegexLiteral,
  literalsAreSafe,
  mergeSharedPrefix,
  regexFromSkeleton,
} from "./regex.js";
import { ruleMatches } from "./rule-match.js";
import {
  compareText,
  hasDigitSlot,
  isSafeLiteral,
  type PiiShape,
  skeletonOf,
  sortedUnique,
} from "./text.js";
import type {
  CoveredByDefaultsItem,
  ManualReviewItem,
  RejectedRule,
  Rule,
  RuleCondition,
  RuleConfidence,
  RuleEvidence,
  RuleGroup,
  RuleTarget,
} from "./types.js";

interface Source {
  page: string;
  name: string;
  value: string;
}

type DraftKind =
  | { kind: "param"; param: string }
  | { kind: "skeleton" }
  | { kind: "name-change" }
  | { kind: "record"; detail: RecordKind }
  | { kind: "pii"; detail: PiiShape }
  | { kind: "state" }
  | { kind: "layout" }
  | { kind: "noise"; owner: string };

interface Draft {
  target: RuleTarget;
  names: string[];
  /** Replaces the name list with a pattern (a noise prefix). */
  nameRegex: string | null;
  value: RuleCondition | null;
  evidence: RuleEvidence;
  confidence: RuleConfidence;
  group: RuleGroup;
  kind: DraftKind;
  sources: Source[];
}

export interface GeneratedRules {
  rules: Rule[];
  rejectedRules: RejectedRule[];
  manualReview: ManualReviewItem[];
  coveredByDefaults: CoveredByDefaultsItem[];
  rulesDropped: number;
}

const RECORD_TEMPLATES: Record<RecordKind, string> = {
  digits: "^.*\\d{5,}.*$",
  guid: "^.*[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}.*$",
  timestamp: "^.*\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}.*$",
  hex: "^.*[0-9A-Fa-f]{16,}.*$",
};

const PII_TEMPLATES: Record<PiiShape, string> = {
  email: "^.*[^\\s@]@[^\\s@]+\\.[A-Za-z]{2,}.*$",
  phone: "^.*\\d{3}[\\s.)-]{1,2}\\d{3}[\\s.-]\\d{4}.*$",
  digits: "^.*\\d{5,}.*$",
};

const RECORD_TEXT: Record<RecordKind, string> = {
  digits: "a number of 5 or more digits",
  guid: "a GUID",
  timestamp: "a timestamp",
  hex: "a long hexadecimal id",
};

const PII_TEXT: Record<PiiShape, string> = {
  email: "an email address",
  phone: "a phone number",
  digits: "a run of 5 or more digits",
};

const SET_DIFF_CAVEAT =
  "This compares the sets of values each run had: it cannot tell an attribute that changed from data that changed, such as different rows.";

const GROUP_ORDER: RuleGroup[] = ["main", "review", "record-specific"];
const TARGET_ORDER: RuleTarget[] = [
  "id",
  "class",
  "attribute-name",
  "attribute-value",
];
const EVIDENCE_ORDER: RuleEvidence[] = [
  "observed_change",
  "pattern",
  "record_specific",
  "pii",
  "heuristic",
  "noise",
];

function targetOf(name: string): RuleTarget {
  return name === "id" ? "id" : name === "class" ? "class" : "attribute-value";
}

function valueCondition(
  operator: RuleCondition["operator"],
  value: string,
): RuleCondition {
  return { category: "Attribute Value", operator, value };
}

function nameCondition(draft: Draft): RuleCondition {
  if (draft.nameRegex) {
    return {
      category: "Attribute Name",
      operator: "Regex",
      value: draft.nameRegex,
    };
  }
  return draft.names.length === 1
    ? { category: "Attribute Name", operator: "Equals", value: draft.names[0]! }
    : {
        category: "Attribute Name",
        operator: "In",
        value: draft.names.join(","),
      };
}

function conditionsOf(draft: Draft): RuleCondition[] {
  return draft.value
    ? [nameCondition(draft), draft.value]
    : [nameCondition(draft)];
}

function draftKey(draft: Draft): string {
  return JSON.stringify([
    draft.target,
    conditionsOf(draft),
    draft.evidence,
    draft.confidence,
    draft.group,
  ]);
}

function reasonOf(draft: Draft): string {
  const list = draft.names.join(", ");
  const { kind } = draft;
  switch (kind.kind) {
    case "param":
      return draft.confidence === "element-diff"
        ? `The same element had a different ${list} value between runs of the same page, in the query parameter ${kind.param}.`
        : `Values of ${list} differed between runs of the same page in the query parameter ${kind.param}. ${SET_DIFF_CAVEAT}`;
    case "skeleton":
      if (draft.nameRegex) {
        return "These attribute names differ only in their digits: the number is generated per build or per component, as in Angular's view encapsulation.";
      }
      if (draft.evidence === "pattern") {
        return `Two or more values of ${list} on one page differ only in their digits, as generated ids do.`;
      }
      return draft.confidence === "element-diff"
        ? `The same element had a different ${list} value between runs of the same page, differing only in its digits.`
        : `Values of ${list} differed between runs of the same page, only in their digits. ${SET_DIFF_CAVEAT}`;
    case "name-change":
      return draft.confidence === "element-diff"
        ? `The same element had a different ${list} value between runs of the same page.`
        : `Every value of ${list} differed between runs of the same page. ${SET_DIFF_CAVEAT}`;
    case "record":
      return `Values of ${list} carry ${RECORD_TEXT[kind.detail]}. Only a guide meant for one specific record needs them.`;
    case "pii":
      return `Values of ${list} contain ${PII_TEXT[kind.detail]}. The values are not stored. Names in values cannot be detected.`;
    case "state":
      return draft.target === "class"
        ? "State classes change with interaction. Heuristic: not observed changing."
        : `Interaction state (${list}). Heuristic: not observed changing.`;
    case "layout":
      return `Presentation only (${list}). Heuristic: not observed changing.`;
    case "noise":
      return `Noise from ${kind.owner} on the capturing machine, not the application. End users without it will not have it.`;
  }
}

interface Index {
  /** Every item by attribute name, across pages. */
  byName: Map<string, Array<{ page: string; item: ClassifiedItem }>>;
  /** Values seen unchanged in every compared run of some page. */
  verifiedStable: Map<string, Set<string>>;
}

function buildIndex(pages: ClassifiedPage[]): Index {
  const byName = new Map<
    string,
    Array<{ page: string; item: ClassifiedItem }>
  >();
  const verifiedStable = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const item of page.items) {
      const list = byName.get(item.name) ?? [];
      list.push({ page: page.pageId, item });
      byName.set(item.name, list);
      if (item.bucket === "stable" && item.verified) {
        const set = verifiedStable.get(item.name) ?? new Set<string>();
        set.add(item.value);
        verifiedStable.set(item.name, set);
      }
    }
  }
  return { byName, verifiedStable };
}

function draft(
  partial: Omit<Draft, "nameRegex" | "sources" | "names"> & {
    names: string[];
    nameRegex?: string;
  },
  source: Source,
): Draft {
  return { nameRegex: null, ...partial, sources: [source] };
}

interface Collected {
  drafts: Draft[];
  manual: ManualReviewItem[];
  covered: CoveredByDefaultsItem[];
}

function manualItem(
  target: RuleTarget,
  name: string,
  reason: string,
  sources: Source[],
): ManualReviewItem {
  return {
    target,
    name,
    reason,
    valueCount: new Set(sources.map((s) => s.value)).size,
    pages: sortedUnique(sources.map((s) => s.page)),
  };
}

const UNSAFE_LITERAL =
  "The values have no shape that can be written without copying page data into the rule.";
const NO_SHARED_SHAPE =
  "Values changed between runs with no shared shape, and other values of this attribute stayed the same.";

function collect(pages: ClassifiedPage[]): Collected {
  const drafts: Draft[] = [];
  const manual: ManualReviewItem[] = [];
  const coveredSources = new Map<
    string,
    { entry: CoveredByDefaultsItem; sources: Source[] }
  >();
  const arbitrary = new Map<string, Source[]>();

  for (const page of pages) {
    const confirmed = page.elementConfirmed;
    const settledNames = new Set<string>();
    for (const item of page.items) {
      if (
        item.bucket !== "observed-change" &&
        item.bucket !== "noise" &&
        item.bucket !== "covered-by-defaults"
      ) {
        settledNames.add(item.name);
      }
    }
    for (const item of page.items) {
      const source: Source = {
        page: page.pageId,
        name: item.name,
        value: item.value,
      };
      const target = targetOf(item.name);
      const base = { target, names: [item.name] };
      switch (item.bucket) {
        case "noise": {
          const matcher = item.noise?.matcher ?? "";
          if (
            !matcher.startsWith("attribute:") ||
            DEFAULT_IGNORE.attribute(item.name)
          ) {
            break;
          }
          const prefix = matcher.slice("attribute:".length);
          drafts.push(
            draft(
              {
                target: "attribute-name",
                names: [prefix],
                nameRegex: anchored(`${escapeRegexLiteral(prefix)}.*`),
                value: null,
                evidence: "noise",
                confidence: "convention",
                group: "review",
                kind: { kind: "noise", owner: item.noise!.owner },
              },
              source,
            ),
          );
          break;
        }
        case "covered-by-defaults": {
          const skeleton = skeletonOf(item.value);
          const regex = regexFromSkeleton(skeleton);
          const generalized =
            item.defaultRule !== "attribute-name" &&
            hasDigitSlot(skeleton) &&
            literalsAreSafe(regex.literals)
              ? anchored(regex.body)
              : null;
          const key = JSON.stringify([
            target,
            item.name,
            item.defaultRule,
            generalized,
          ]);
          const existing = coveredSources.get(key) ?? {
            entry: {
              target:
                item.defaultRule === "attribute-name"
                  ? "attribute-name"
                  : target,
              name: item.name,
              generalized,
              defaultRule: item.defaultRule!,
              valueCount: 0,
              pages: [],
              exampleValues: [],
            },
            sources: [],
          };
          existing.sources.push(source);
          coveredSources.set(key, existing);
          break;
        }
        case "observed-change": {
          const confidence: RuleConfidence = confirmed.has(item.name)
            ? "element-diff"
            : "set-diff";
          const common = {
            ...base,
            evidence: "observed_change" as const,
            confidence,
            group: "main" as const,
          };
          const safeParams = item.changedParams.filter(isSafeLiteral);
          if (safeParams.length > 0) {
            for (const param of safeParams) {
              drafts.push(
                draft(
                  {
                    ...common,
                    value: valueCondition("Contains", param),
                    kind: { kind: "param", param },
                  },
                  source,
                ),
              );
            }
            break;
          }
          const skeleton = skeletonOf(item.value);
          if (hasDigitSlot(skeleton)) {
            const regex = regexFromSkeleton(skeleton);
            if (literalsAreSafe(regex.literals)) {
              drafts.push(
                draft(
                  {
                    ...common,
                    value: valueCondition("Regex", anchored(regex.body)),
                    kind: { kind: "skeleton" },
                  },
                  source,
                ),
              );
            } else {
              manual.push(
                manualItem(target, item.name, UNSAFE_LITERAL, [source]),
              );
            }
            break;
          }
          if (target === "attribute-value" && !settledNames.has(item.name)) {
            drafts.push(
              draft(
                {
                  ...common,
                  target: "attribute-name",
                  value: null,
                  kind: { kind: "name-change" },
                },
                source,
              ),
            );
          } else {
            const list = arbitrary.get(`${target}\u0000${item.name}`) ?? [];
            list.push(source);
            arbitrary.set(`${target}\u0000${item.name}`, list);
          }
          break;
        }
        case "pattern": {
          if (item.namePattern) {
            const regex = regexFromSkeleton(skeletonOf(item.name));
            if (!literalsAreSafe(regex.literals)) {
              manual.push(
                manualItem("attribute-name", item.name, UNSAFE_LITERAL, [
                  source,
                ]),
              );
              break;
            }
            drafts.push(
              draft(
                {
                  target: "attribute-name",
                  names: [item.name],
                  nameRegex: anchored(regex.body),
                  value: null,
                  evidence: "pattern",
                  confidence: "shape",
                  group: "main",
                  kind: { kind: "skeleton" },
                },
                source,
              ),
            );
            break;
          }
          const regex = regexFromSkeleton(skeletonOf(item.value));
          if (literalsAreSafe(regex.literals)) {
            drafts.push(
              draft(
                {
                  ...base,
                  value: valueCondition("Regex", anchored(regex.body)),
                  evidence: "pattern",
                  confidence: "shape",
                  group: "main",
                  kind: { kind: "skeleton" },
                },
                source,
              ),
            );
          } else {
            manual.push(
              manualItem(target, item.name, UNSAFE_LITERAL, [source]),
            );
          }
          break;
        }
        case "record-specific":
          drafts.push(
            draft(
              {
                ...base,
                value: valueCondition(
                  "Regex",
                  RECORD_TEMPLATES[item.recordKind!],
                ),
                evidence: "record_specific",
                confidence: "shape",
                group: "record-specific",
                kind: { kind: "record", detail: item.recordKind! },
              },
              source,
            ),
          );
          break;
        case "state-driven":
          if (target === "class") {
            if (isSafeLiteral(item.value)) {
              drafts.push(
                draft(
                  {
                    ...base,
                    value: valueCondition("Equals", item.value),
                    evidence: "heuristic",
                    confidence: "convention",
                    group: "review",
                    kind: { kind: "state" },
                  },
                  source,
                ),
              );
            } else {
              manual.push(
                manualItem(target, item.name, UNSAFE_LITERAL, [source]),
              );
            }
            break;
          }
          drafts.push(
            draft(
              {
                ...base,
                target: "attribute-name",
                value: null,
                evidence: "heuristic",
                confidence: "convention",
                group: "review",
                kind: { kind: "state" },
              },
              source,
            ),
          );
          break;
        case "layout-only":
          drafts.push(
            draft(
              {
                ...base,
                target: "attribute-name",
                value: null,
                evidence: "heuristic",
                confidence: "convention",
                group: "review",
                kind: { kind: "layout" },
              },
              source,
            ),
          );
          break;
        case "pii":
          drafts.push(
            draft(
              {
                ...base,
                value: valueCondition("Regex", PII_TEMPLATES[item.pii!]),
                evidence: "pii",
                confidence: "shape",
                group: "main",
                kind: { kind: "pii", detail: item.pii! },
              },
              source,
            ),
          );
          break;
        case "stable":
          break;
      }
    }
  }
  for (const [key, sources] of arbitrary) {
    const [target, name] = key.split("\u0000") as [RuleTarget, string];
    manual.push(manualItem(target, name, NO_SHARED_SHAPE, sources));
  }
  const covered = [...coveredSources.values()].map(({ entry, sources }) => ({
    ...entry,
    valueCount: new Set(sources.map((s) => s.value)).size,
    pages: sortedUnique(sources.map((s) => s.page)),
    exampleValues: examplesOf(sources),
  }));
  return { drafts, manual, covered };
}

function examplesOf(sources: Source[]): string[] {
  return sortedUnique(sources.map((s) => s.value))
    .filter(isSafeLiteral)
    .slice(0, DOM_CONFIG_LIMITS.maxExamples);
}

function dedupe(drafts: Draft[]): Draft[] {
  const byKey = new Map<string, Draft>();
  for (const d of drafts) {
    const key = draftKey(d);
    const existing = byKey.get(key);
    if (existing) existing.sources.push(...d.sources);
    else byKey.set(key, { ...d, sources: [...d.sources] });
  }
  return [...byKey.values()];
}

/** Names `rule` can apply to among those observed. */
function namesIn(draft: Draft, index: Index): string[] {
  if (!draft.nameRegex) return draft.names;
  const regex = compileRuleRegex(draft.nameRegex);
  return [...index.byName.keys()].filter((name) => regex?.test(name));
}

function provisionalRule(draft: Draft): Rule {
  return {
    id: "",
    target: draft.target,
    conditions: conditionsOf(draft),
    evidence: draft.evidence,
    confidence: draft.confidence,
    reason: "",
    pages: [],
    coveredValueCount: 0,
    exampleValues: [],
    group: draft.group,
  };
}

type Verdict =
  | { ok: true }
  | { ok: false; manual: ManualReviewItem }
  | { ok: false; rejected: RejectedRule };

function validate(draft: Draft, index: Index): Verdict {
  const rule = provisionalRule(draft);
  const label = draft.nameRegex ?? draft.names.join(",");
  for (const condition of rule.conditions) {
    if (condition.operator === "Regex" && !compileRuleRegex(condition.value)) {
      return {
        ok: false,
        manual: manualItem(
          draft.target,
          label,
          `The pattern is longer than ${DOM_CONFIG_LIMITS.maxRegexLength} characters or does not compile.`,
          draft.sources,
        ),
      };
    }
  }
  if (!draft.sources.every((s) => ruleMatches(rule, s.name, s.value))) {
    return {
      ok: false,
      manual: manualItem(
        draft.target,
        label,
        "The generalized rule does not match every value it was built from.",
        draft.sources,
      ),
    };
  }
  let stableMatches = 0;
  for (const name of namesIn(draft, index)) {
    for (const value of index.verifiedStable.get(name) ?? []) {
      if (ruleMatches(rule, name, value)) stableMatches++;
    }
  }
  if (stableMatches > 0) {
    return {
      ok: false,
      rejected: {
        rule: finalizeRule(draft, index),
        reason: `It would also ignore ${stableMatches} value(s) that stayed the same in every run of a page.`,
        stableMatches,
      },
    };
  }
  return { ok: true };
}

function mergeGroups(
  drafts: Draft[],
  keyOf: (d: Draft) => string | null,
  merge: (group: Draft[]) => Draft | null,
): Draft[] {
  const groups = new Map<string, Draft[]>();
  const rest: Draft[] = [];
  for (const d of drafts) {
    const key = keyOf(d);
    if (key === null) {
      rest.push(d);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  for (const group of groups.values()) {
    const merged = group.length > 1 ? merge(group) : null;
    if (merged) rest.push(merged);
    else rest.push(...group);
  }
  return rest;
}

const sameOrigin = (d: Draft) =>
  JSON.stringify([d.evidence, d.confidence, d.group, d.kind]);

/** Union-exact compaction: several names into `In`, several values into `In`, several patterns into one alternation. */
function compact(drafts: Draft[]): Draft[] {
  let result = mergeGroups(
    drafts,
    (d) =>
      d.value?.operator === "Equals" && !d.nameRegex
        ? JSON.stringify([d.target, d.names, sameOrigin(d)])
        : null,
    (group) => ({
      ...group[0]!,
      value: valueCondition(
        "In",
        sortedUnique(group.map((d) => d.value!.value)).join(","),
      ),
      sources: group.flatMap((d) => d.sources),
    }),
  );
  result = mergeGroups(
    result,
    (d) =>
      !d.nameRegex &&
      (d.target === "attribute-name" || d.target === "attribute-value")
        ? JSON.stringify([d.target, d.value, sameOrigin(d)])
        : null,
    (group) => ({
      ...group[0]!,
      names: sortedUnique(group.flatMap((d) => d.names)),
      sources: group.flatMap((d) => d.sources),
    }),
  );
  return mergeGroups(
    result,
    (d) =>
      d.kind.kind === "skeleton" && d.value?.operator === "Regex"
        ? JSON.stringify([
            d.target,
            d.names,
            sameOrigin(d),
            d.value.value.slice(1, 4),
          ])
        : null,
    (group) => {
      const bodies = group.map((d) => d.value!.value.slice(1, -1));
      const merged = mergeSharedPrefix(bodies);
      return merged
        ? {
            ...group[0]!,
            value: valueCondition("Regex", anchored(merged)),
            sources: group.flatMap((d) => d.sources),
          }
        : null;
    },
  );
}

const rank = (d: Draft) =>
  GROUP_ORDER.indexOf(d.group) * EVIDENCE_ORDER.length +
  EVIDENCE_ORDER.indexOf(d.evidence);

/** One rule per condition list: the same pattern found by observation on one page and by shape on another is written once, under the stronger evidence. */
function mergeIdenticalConditions(drafts: Draft[]): Draft[] {
  return mergeGroups(
    drafts,
    (d) => JSON.stringify([d.target, conditionsOf(d)]),
    (group) => {
      const best = group.reduce((a, b) => (rank(b) < rank(a) ? b : a));
      return { ...best, sources: group.flatMap((d) => d.sources) };
    },
  );
}

function finalizeRule(draft: Draft, index: Index): Rule {
  const rule = provisionalRule(draft);
  const counted = new Set<string>();
  for (const name of namesIn(draft, index)) {
    for (const { item } of index.byName.get(name) ?? []) {
      if (item.bucket === "covered-by-defaults") continue;
      if (item.bucket === "noise" && draft.evidence !== "noise") continue;
      if (ruleMatches(rule, item.name, item.value)) {
        counted.add(`${item.name}\u0000${item.value}`);
      }
    }
  }
  return {
    ...rule,
    id: `r-${fnv1a(JSON.stringify([rule.conditions, rule.evidence, rule.group]))}`,
    reason: reasonOf(draft),
    pages: sortedUnique(draft.sources.map((s) => s.page)),
    coveredValueCount: counted.size,
    exampleValues: draft.evidence === "noise" ? [] : examplesOf(draft.sources),
  };
}

function compareRules(a: Rule, b: Rule): number {
  return (
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
    TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target) ||
    EVIDENCE_ORDER.indexOf(a.evidence) - EVIDENCE_ORDER.indexOf(b.evidence) ||
    compareText(JSON.stringify(a.conditions), JSON.stringify(b.conditions))
  );
}

function mergeManual(items: ManualReviewItem[]): ManualReviewItem[] {
  const byKey = new Map<string, ManualReviewItem>();
  for (const item of items) {
    const key = JSON.stringify([item.target, item.name, item.reason]);
    const existing = byKey.get(key);
    if (existing) {
      existing.valueCount += item.valueCount;
      existing.pages = sortedUnique([...existing.pages, ...item.pages]);
    } else {
      byKey.set(key, { ...item });
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target) ||
      compareText(a.name, b.name) ||
      compareText(a.reason, b.reason),
  );
}

export function generateRules(pages: ClassifiedPage[]): GeneratedRules {
  const index = buildIndex(pages);
  const { drafts, manual, covered } = collect(pages);
  const accepted: Draft[] = [];
  const rejectedRules: RejectedRule[] = [];
  for (const d of dedupe(drafts)) {
    const verdict = validate(d, index);
    if (verdict.ok) accepted.push(d);
    else if ("manual" in verdict) manual.push(verdict.manual);
    else rejectedRules.push(verdict.rejected);
  }
  const all = mergeIdenticalConditions(compact(accepted))
    .map((d) => finalizeRule(d, index))
    .sort(compareRules);
  const rules = all.slice(0, DOM_CONFIG_LIMITS.maxRules);
  return {
    rules,
    rejectedRules: rejectedRules.sort((a, b) => compareRules(a.rule, b.rule)),
    manualReview: mergeManual(manual),
    coveredByDefaults: covered.sort(
      (a, b) =>
        TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target) ||
        compareText(a.name, b.name) ||
        compareText(a.generalized ?? "", b.generalized ?? ""),
    ),
    rulesDropped: all.length - rules.length,
  };
}
