/**
 * What the DOM Config report's copy buttons and exports produce. Pure: the
 * labels come in already translated. Every copy and export uses the rules
 * the SE left included, never the full list.
 */
import type {
  DomConfigPartialSelectorRule,
  DomConfigReport,
  DomConfigRule,
  DomConfigRuleCondition,
} from "@apty/browser-runtime/apty/dom-config/index";

export interface RuleChoices {
  ruleChoices: Record<string, boolean>;
  includeReview: boolean;
  includeRecordSpecific: boolean;
}

export function isRuleIncluded(
  rule: DomConfigRule,
  choices: RuleChoices,
): boolean {
  if (rule.group === "record-specific") {
    return (
      choices.includeRecordSpecific && (choices.ruleChoices[rule.id] ?? true)
    );
  }
  return (
    choices.ruleChoices[rule.id] ??
    (rule.group === "main" ? true : choices.includeReview)
  );
}

/** The report as exported: only the included rules. */
export function exportedReport(
  report: DomConfigReport,
  choices: RuleChoices,
): DomConfigReport {
  return {
    ...report,
    rules: report.rules.filter((rule) => isRuleIncluded(rule, choices)),
  };
}

/** A page's URL shape without its origin: `/patients/:id/chart?tab`. */
export function pathOf(urlShape: string): string {
  try {
    const url = new URL(urlShape);
    return `${url.pathname}${url.search}${url.hash}` || urlShape;
  } catch {
    return urlShape;
  }
}

/** One condition as Apty's editor shows its row: mode, attribute (for an Attribute Value row), operator, value. */
export function conditionLabel(condition: DomConfigRuleCondition): string {
  return [
    condition.category,
    condition.attribute,
    condition.operator,
    condition.value,
  ]
    .filter(Boolean)
    .join(" ");
}

export function conditionText(rule: DomConfigRule, or: string): string {
  return rule.conditions.map(conditionLabel).join(` ${or} `);
}

function cell(text: string): string {
  return text.replace(/[\t\r\n]+/g, " ");
}

/** Tab-separated rows, pasteable into a spreadsheet. */
export function tsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(cell).join("\t")).join("\n");
}

interface RuleTableLabels {
  header: [string, string, string, string, string, string];
  or: string;
  evidence: (rule: DomConfigRule) => string;
}

export function rulesTable(
  rules: DomConfigRule[],
  labels: RuleTableLabels,
): string {
  return tsv(
    labels.header,
    rules.map((rule) => [
      conditionText(rule, labels.or),
      labels.evidence(rule),
      rule.reason,
      rule.pages.map(pathOf).join(", "),
      String(rule.coveredValueCount),
      rule.exampleValues.join(", "),
    ]),
  );
}

export function partialTable(
  rules: DomConfigPartialSelectorRule[],
  header: [string, string, string, string, string],
): string {
  return tsv(
    header,
    rules.map((rule) => [
      rule.attribute,
      rule.pattern,
      rule.exampleParts.join(", "),
      String(rule.elementCount),
      rule.pages.map(pathOf).join(", "),
    ]),
  );
}

export interface SettingRow {
  label: string;
  value: string;
  basis: string;
  reason: string;
}

export function settingsTable(
  rows: SettingRow[],
  header: [string, string, string, string],
): string {
  return tsv(
    header,
    rows.map((row) => [row.label, row.value, row.basis, row.reason]),
  );
}

export function download(
  content: string,
  fileName: string,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function slug(name: string, fallback: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || fallback;
}

/** A file name from the application name: letters, digits and dashes only. */
export function exportFileName(applicationName: string, extension: string) {
  return `apty-dom-config-${slug(applicationName, "application")}.${extension}`;
}

export function profileFileName(pageLabel: string, run: number): string {
  return `apty-dom-profile-${slug(pageLabel, "page")}-run-${run}.json`;
}
