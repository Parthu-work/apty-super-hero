/**
 * Input and output shapes of the DOM Config engine. The profile shapes
 * themselves (`DomProfile`, `DomProfileV2`) live in `@apty/dom-snapshot`,
 * next to the collector that writes them.
 */

export type {
  BehaviorProbe,
  DomProfile,
  DomProfileFrame,
  DomProfileNode,
  DomProfileV2,
  ZIndexSource,
} from "@apty/dom-snapshot";

import type { DomProfileV2 } from "@apty/dom-snapshot";

export type RunLabel = "initial" | "after-reload" | "repeat";

export interface RunMeta {
  label: RunLabel;
  /** Only ever copied from the input; the engine reads no clock. */
  capturedAt?: string;
  urlShape?: string;
  aptyPresent: boolean;
  extensionNoisePresent: boolean;
  stateFingerprint?: string;
  partial?: boolean;
  stateMismatch?: boolean;
}

export interface ProfileRun {
  meta: RunMeta;
  profile: DomProfileV2;
}

export interface PageCapture {
  pageId: string;
  label: string;
  runs: ProfileRun[];
  /** How the page was captured; the engine does not read it. */
  origin?: "crawl" | "manual" | "import";
}

export interface ApplicationCapture {
  applicationName: string;
  pages: PageCapture[];
}

export type RuleCategory = "Attribute Name" | "Attribute Value";

export type RuleOperator =
  | "Equals"
  | "Not equals"
  | "Contains"
  | "Does not contain"
  | "In"
  | "Not in"
  | "Regex";

export interface RuleCondition {
  category: RuleCategory;
  operator: RuleOperator;
  value: string;
}

export type RuleTarget = "id" | "class" | "attribute-name" | "attribute-value";

export type RuleEvidence =
  | "observed_change"
  | "pattern"
  | "record_specific"
  | "noise"
  | "heuristic"
  | "pii";

export type RuleConfidence =
  | "set-diff"
  | "element-diff"
  | "shape"
  | "convention";

export type RuleGroup = "main" | "review" | "record-specific";

export interface Rule {
  id: string;
  target: RuleTarget;
  /** Combined with ALL. */
  conditions: RuleCondition[];
  evidence: RuleEvidence;
  confidence: RuleConfidence;
  reason: string;
  pages: string[];
  coveredValueCount: number;
  exampleValues: string[];
  group: RuleGroup;
}

export interface RejectedRule {
  rule: Rule;
  reason: string;
  stableMatches: number;
}

export interface ManualReviewItem {
  target: RuleTarget;
  name: string;
  reason: string;
  valueCount: number;
  pages: string[];
}

export type DefaultIgnoreRule =
  | "attribute-name"
  | "id-for-digits"
  | "class-tether";

/** Something Apty already ignores with no configuration: reported, never emitted as a rule. */
export interface CoveredByDefaultsItem {
  target: RuleTarget;
  name: string;
  /** The values in a generalized form, when that form is safe to show. */
  generalized: string | null;
  defaultRule: DefaultIgnoreRule;
  valueCount: number;
  pages: string[];
  exampleValues: string[];
}

export type SettingBasis = "measured" | "derived" | "default";

export interface Setting<T> {
  value: T;
  basis: SettingBasis;
  reason: string;
}

export interface AttributePriorityEntry {
  name: string;
  reason: string;
  /** Distinct stable values / occurrences; null for positions fixed by kind. */
  uniqueness: number | null;
  stablePages: number;
}

export interface PriorityDiffEntry {
  name: string;
  proposedPosition: number | null;
  defaultPosition: number | null;
}

export interface AttributePriority extends Setting<string> {
  entries: AttributePriorityEntry[];
  defaultPriority: string[];
  diff: PriorityDiffEntry[];
}

export interface ZIndexSourceSummary {
  value: number;
  tag: string | null;
  id: string | null;
  class: string | null;
  pages: string[];
}

export interface ExcludedZIndex {
  value: number;
  source: string;
  pages: string[];
}

export interface MaxZIndexSetting extends Setting<number> {
  appMax: number | null;
  /** Null when the highest value's element is unknown (a schema 1 profile records only the number). */
  appMaxSource: ZIndexSourceSummary | null;
  excluded: ExcludedZIndex[];
}

export interface ContainerScoreThreshold {
  referenceConfigValue: number;
  reconstructedModelValue: number;
  basis: "default";
  reason: string;
}

export interface IframeEntry {
  pages: string[];
  src: string;
  crossOrigin: boolean | null;
  kind: "application" | "extension" | "overlay";
  analyzed: boolean;
  reason: string;
  needsHandling: boolean;
}

export type CoverageKey =
  | "entry-forms"
  | "detail-pages"
  | "list-grid-pages"
  | "modals-dialogs"
  | "popups"
  | "dropdown-panels"
  | "tooltips"
  | "side-panels"
  | "print-report-views"
  | "embedded-documents"
  | "click-only-states";

export type CoverageStatus =
  | "captured"
  | "not-applicable"
  | "planned"
  | "not-captured";

export interface CoverageItem {
  key: CoverageKey;
  status: CoverageStatus;
  /** Captured pages whose markup suggests this kind of state. */
  candidates: string[];
}

export interface CoverageReport {
  items: CoverageItem[];
  notCaptured: CoverageKey[];
}

export type WarningCode =
  | "weak-selectors"
  | "pii-values"
  | "names-not-detected"
  | "incomplete-capture"
  | "state-mismatch"
  | "single-run-pages"
  | "no-test-attributes"
  | "rejected-rules"
  | "apty-inconsistent"
  | "truncated"
  | "unconfirmed-noise"
  | "covered-by-defaults"
  | "closed-shadow-roots"
  | "legacy-closed-shadow-roots"
  | "large-dom"
  | "rule-cap";

export interface ReportWarning {
  code: WarningCode;
  severity: "info" | "warn";
  message: string;
  pages: string[];
  count: number;
}

export interface WeakSelector {
  /** `.RptTable` or `[name="delete"]`; `[value withheld]` stands in for a value that is not safe to show. */
  selector: string;
  maxPerPage: number;
  pages: string[];
}

export type PageStatus = "stable" | "changing" | "unreliable" | "single-run";

export interface RunSummary {
  label: RunLabel;
  capturedAt: string | null;
  urlShape: string | null;
  aptyPresent: boolean;
  extensionNoisePresent: boolean;
  partial: boolean;
  stateMismatch: boolean;
  elementCount: number;
}

export interface ValueDiffEntry {
  name: string;
  change: "added" | "removed" | "count";
  /** PII-shaped values read `[PII value hidden]`. */
  value: string;
  fromCount: number;
  toCount: number;
}

export interface TagDiffEntry {
  tag: string;
  fromCount: number;
  toCount: number;
}

export interface RunPairDiff {
  from: number;
  to: number;
  values: ValueDiffEntry[];
  tags: TagDiffEntry[];
  noiseValues: ValueDiffEntry[];
  noiseTags: TagDiffEntry[];
  truncated: boolean;
}

export interface PageSummary {
  pageId: string;
  label: string;
  status: PageStatus;
  runs: RunSummary[];
  diffs: RunPairDiff[];
  maxZIndex: number | null;
  shadowHosts: string[];
  iframeCount: number;
}

export interface UnreadyPage {
  pageId: string;
  label: string;
  reason: "single-run" | "unreliable";
}

export interface NoiseEntry {
  matcher: string;
  owner: string;
  source: "apty" | "extension" | "overlay";
  count: number;
  pages: string[];
}

export interface UnconfirmedNoiseEntry {
  marker: string;
  count: number;
  pages: string[];
}

export interface TruncationEntry {
  pageId: string;
  run: number;
  kind:
    | "distinct-values"
    | "value-length"
    | "stored-chars"
    | "collector"
    | "runs"
    | "pages";
  name: string | null;
  dropped: number;
}

export interface NotMeasuredEntry {
  item: string;
  text: string;
}

export interface Assumption {
  code: string;
  text: string;
}

export interface PiiCounts {
  email: number;
  phone: number;
  digits: number;
}

export interface DomConfigReport {
  applicationName: string;
  toolVersion: string;
  ruleListVersion: string;
  captureDates: string[];
  pages: PageSummary[];
  rules: Rule[];
  rejectedRules: RejectedRule[];
  manualReview: ManualReviewItem[];
  coveredByDefaults: CoveredByDefaultsItem[];
  attributePriority: AttributePriority;
  shadowDom: Setting<boolean>;
  debounce: Setting<number>;
  ignoreEvents: Setting<string[]>;
  maxZIndex: MaxZIndexSetting;
  containerScoreThreshold: ContainerScoreThreshold;
  clickAdvance: Setting<null>;
  iframes: IframeEntry[];
  coverage: CoverageReport;
  weakSelectors: WeakSelector[];
  warnings: ReportWarning[];
  unreadyPages: UnreadyPage[];
  notMeasured: NotMeasuredEntry[];
  noise: NoiseEntry[];
  unconfirmedNoise: UnconfirmedNoiseEntry[];
  truncations: TruncationEntry[];
  piiCounts: PiiCounts;
  assumptions: Assumption[];
  openQuestions: string[];
}

export interface DomConfigReportOptions {
  /** Settings → Troubleshooting entries (`id:prefix`, `class:prefix`, `tag:name`). */
  ignoredRoots?: readonly string[];
  coverage?: Partial<
    Record<CoverageKey, Exclude<CoverageStatus, "not-captured">>
  >;
}
