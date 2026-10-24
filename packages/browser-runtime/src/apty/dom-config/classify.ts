/**
 * Puts every id value, class token and other attribute value of a page in
 * exactly one bucket, first match wins (R1.4): noise, covered by Apty's
 * defaults, observed change, pattern, record-specific, state-driven,
 * layout-only, PII-bearing, stable. An attribute is ignored because it
 * changed, follows a dynamic pattern or names a record, never because of
 * what it holds; the state, layout and PII buckets are heuristics and are
 * labeled as such. `looksDynamic` is deliberately not used: the buckets
 * here are their own definition (docs/development/dom-config.md).
 */
import {
  classifyUnstableClass,
  DEFAULT_IGNORE,
  isUnstableAttributeName,
} from "@apty/dom-snapshot";
import { type PageDiff, valuesByName } from "./diff-runs.js";
import type { FlatRun } from "./flatten.js";
import {
  attributeNameNoise,
  attributeValueNoise,
  classNoise,
  type NoiseHit,
  type NoisePolicy,
} from "./noise.js";
import {
  hasDigitSlot,
  isUrlLike,
  type PiiShape,
  piiShapeOf,
  queryParams,
  skeletonOf,
  sortedUnique,
  withoutQuery,
  withoutUrlPorts,
} from "./text.js";
import type { DefaultIgnoreRule } from "./types.js";

export type Bucket =
  | "noise"
  | "covered-by-defaults"
  | "observed-change"
  | "pattern"
  | "record-specific"
  | "state-driven"
  | "layout-only"
  | "pii"
  | "stable";

export type ItemKind = "id" | "class" | "attribute";

export type RecordKind = "guid" | "timestamp" | "digits" | "hex";

export interface ClassifiedItem {
  kind: ItemKind;
  /** `id`, `class`, or the attribute name. */
  name: string;
  value: string;
  bucket: Bucket;
  /** Highest count in one run of the page. */
  count: number;
  /** Present in every complete run of the intended state, and there were at least two. */
  verified: boolean;
  pii: PiiShape | null;
  noise: NoiseHit | null;
  defaultRule: DefaultIgnoreRule | null;
  recordKind: RecordKind | null;
  /** For a changed URL-shaped value: the query parameters whose value differed between runs of the same link. */
  changedParams: string[];
  /** The pattern is in the attribute's name (`_ngcontent-ng-c123`), not its value. */
  namePattern: boolean;
}

export interface ClassifiedPage {
  pageId: string;
  label: string;
  items: ClassifiedItem[];
  /** At least two runs could be compared. */
  compared: boolean;
  elementConfirmed: ReadonlySet<string>;
}

/** One page with everything the engine derived from its runs. */
export interface AnalyzedPage {
  pageId: string;
  label: string;
  runs: FlatRun[];
  diff: PageDiff;
  classified: ClassifiedPage;
}

const LAYOUT_ATTRIBUTES = new Set([
  "width",
  "height",
  "align",
  "valign",
  "border",
  "cellpadding",
  "bgcolor",
  "colspan",
  "rowspan",
  "nowrap",
]);

const STATE_ATTRIBUTES = new Set(["tabindex", "disabled", "selected", "style"]);

export function isStateAttribute(name: string): boolean {
  return name.startsWith("aria-") || STATE_ATTRIBUTES.has(name);
}

export function isLayoutAttribute(name: string): boolean {
  return LAYOUT_ATTRIBUTES.has(name);
}

const STATE_CLASS_WORDS = new Set(["even", "odd", "active", "open", "hidden"]);
/** ASSUMPTION: the brief's `ui-*` state classes read as jQuery UI's `ui-state-*`; structural `ui-widget` or `ui-dialog` stay identity. */
const JQUERY_UI_STATE_CLASS = /^ui-state-/;
/** ASSUMPTION (general knowledge of ag-Grid's markup, not measured): its per-row and per-cell state classes. */
const AG_GRID_STATE_CLASS =
  /^ag-(?:row|cell|column|header-cell)-(?:even|odd|first|last|focus|hover|selected|level-\d+|position-absolute|not-inline-editing|inline-editing|range-selected|value-changed)$/;

function isStateClass(token: string): boolean {
  return (
    STATE_CLASS_WORDS.has(token.toLowerCase()) ||
    JQUERY_UI_STATE_CLASS.test(token) ||
    AG_GRID_STATE_CLASS.test(token) ||
    classifyUnstableClass(token) === "state"
  );
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const LONG_DIGITS = /\d{5,}/;
const HEX_ID = /(?<![0-9a-z])[0-9a-f]{16,}(?![0-9a-z])/i;

export function recordKindOf(value: string): RecordKind | null {
  if (GUID.test(value)) return "guid";
  if (ISO_TIMESTAMP.test(value)) return "timestamp";
  if (LONG_DIGITS.test(withoutUrlPorts(value))) return "digits";
  if (HEX_ID.test(value)) return "hex";
  return null;
}

function kindOf(name: string): ItemKind {
  return name === "id" ? "id" : name === "class" ? "class" : "attribute";
}

function defaultRuleOf(name: string, value: string): DefaultIgnoreRule | null {
  if (name === "class") {
    return DEFAULT_IGNORE.class(value) ? "class-tether" : null;
  }
  if (!DEFAULT_IGNORE.attribute(name, value)) return null;
  return DEFAULT_IGNORE.attribute(name) ? "attribute-name" : "id-for-digits";
}

function noiseOf(
  name: string,
  value: string,
  policy: NoisePolicy,
): NoiseHit | null {
  return (
    attributeNameNoise(name, policy) ??
    (name === "class"
      ? classNoise(value, policy)
      : attributeValueNoise(name, value, policy))
  );
}

/** Per URL-shaped value of one name: the parameters whose value differs between runs for the same link. */
function changingParams(values: Iterable<string>): Map<string, string[]> {
  const byLink = new Map<string, Map<string, Set<string>>>();
  const linkOf = (value: string, params: Array<[string, string]>) =>
    `${withoutQuery(value)}?${sortedUnique(params.map(([name]) => name)).join("&")}`;
  const parsed: Array<[string, string, Array<[string, string]>]> = [];
  for (const value of values) {
    const params = queryParams(value);
    if (params.length === 0) continue;
    const link = linkOf(value, params);
    parsed.push([value, link, params]);
    let byParam = byLink.get(link);
    if (!byParam) {
      byParam = new Map();
      byLink.set(link, byParam);
    }
    for (const [param, paramValue] of params) {
      const seen = byParam.get(param) ?? new Set<string>();
      seen.add(paramValue);
      byParam.set(param, seen);
    }
  }
  const result = new Map<string, string[]>();
  for (const [value, link, params] of parsed) {
    const byParam = byLink.get(link)!;
    const changing = sortedUnique(
      params
        .map(([param]) => param)
        .filter((param) => (byParam.get(param)?.size ?? 0) > 1),
    );
    if (changing.length) result.set(value, changing);
  }
  return result;
}

/**
 * Attribute names that differ only in their digits: two or more on the
 * page, or one `isUnstableAttributeName` already knows carries a per-build
 * number (Angular's `_ngcontent-ng-c<n>`). A name without digits, such as
 * `ng-version`, is classified by its values like any other.
 */
function patternNames(names: readonly string[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    if (name === "id" || name === "class") continue;
    const skeleton = skeletonOf(name);
    if (!hasDigitSlot(skeleton)) continue;
    groups.set(skeleton, [...(groups.get(skeleton) ?? []), name]);
  }
  return new Set(
    [...groups.values()].flatMap((group) =>
      group.length >= 2 ? group : group.filter(isUnstableAttributeName),
    ),
  );
}

export function classifyPage(
  pageId: string,
  label: string,
  runs: FlatRun[],
  diff: PageDiff,
  policy: NoisePolicy,
): ClassifiedPage {
  const maps = runs.map(valuesByName);
  const eligibleMaps = diff.eligible.map((index) => maps[index]!);
  const compared = eligibleMaps.length >= 2;
  const items: ClassifiedItem[] = [];
  const names = sortedUnique(maps.flatMap((map) => [...map.keys()]));
  const nameIsPattern = patternNames(names);

  for (const name of names) {
    const perRun = maps.map((map) => map.get(name));
    const counts = new Map<string, number>();
    for (const values of perRun) {
      for (const [value, count] of values ?? []) {
        counts.set(value, Math.max(counts.get(value) ?? 0, count));
      }
    }
    const kind = kindOf(name);
    const changed = diff.changed.get(name) ?? new Set<string>();
    const eligibleValues = eligibleMaps.map((map) => map.get(name));
    const params = changed.size
      ? changingParams(
          new Set(
            eligibleValues.flatMap((values) => [...(values?.keys() ?? [])]),
          ),
        )
      : new Map<string, string[]>();

    const pending: ClassifiedItem[] = [];
    const skeletons = new Map<string, number>();
    for (const value of sortedUnique(counts.keys())) {
      const noise = noiseOf(name, value, policy);
      const defaultRule = noise ? null : defaultRuleOf(name, value);
      const item: ClassifiedItem = {
        kind,
        name,
        value,
        bucket: noise
          ? "noise"
          : defaultRule
            ? "covered-by-defaults"
            : "stable",
        count: counts.get(value)!,
        verified:
          compared && eligibleValues.every((values) => values?.has(value)),
        pii: piiShapeOf(withoutUrlPorts(value)),
        noise,
        defaultRule,
        recordKind: null,
        changedParams: [],
        namePattern: false,
      };
      if (item.bucket === "stable") {
        const skeleton = skeletonOf(value);
        if (hasDigitSlot(skeleton)) {
          skeletons.set(skeleton, (skeletons.get(skeleton) ?? 0) + 1);
        }
        pending.push(item);
      }
      items.push(item);
    }

    for (const item of pending) {
      const { value } = item;
      if (changed.has(value)) {
        item.bucket = "observed-change";
        item.changedParams = params.get(value) ?? [];
      } else if (nameIsPattern.has(name)) {
        item.bucket = "pattern";
        item.namePattern = true;
      } else if ((skeletons.get(skeletonOf(value)) ?? 0) >= 2) {
        item.bucket = "pattern";
      } else if (
        (isUrlLike(name, value) || name.startsWith("data-")) &&
        recordKindOf(value)
      ) {
        item.bucket = "record-specific";
        item.recordKind = recordKindOf(value);
      } else if (
        kind === "class" ? isStateClass(value) : isStateAttribute(name)
      ) {
        item.bucket = "state-driven";
      } else if (kind === "attribute" && isLayoutAttribute(name)) {
        item.bucket = "layout-only";
      } else if (item.pii) {
        item.bucket = "pii";
      }
    }
  }
  return {
    pageId,
    label,
    items,
    compared,
    elementConfirmed: diff.elementConfirmed,
  };
}
