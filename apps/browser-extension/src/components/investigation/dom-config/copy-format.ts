/**
 * What the DOM Config report's copy buttons and exports produce. Pure: the
 * labels come in already translated. Every copy and export uses the rules
 * the SE left included, never the full list.
 */
import type {
  DomConfigReport,
  DomConfigRule,
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

export function conditionText(rule: DomConfigRule, and: string): string {
  return rule.conditions
    .map((c) => `${c.category} ${c.operator} ${c.value}`)
    .join(` ${and} `);
}

function cell(text: string): string {
  return text.replace(/[\t\r\n]+/g, " ");
}

/** Tab-separated rows, pasteable into a spreadsheet. */
function tsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(cell).join("\t")).join("\n");
}

interface RuleTableLabels {
  header: [string, string, string, string, string, string];
  and: string;
  evidence: (rule: DomConfigRule) => string;
}

export function rulesTable(
  rules: DomConfigRule[],
  labels: RuleTableLabels,
): string {
  return tsv(
    labels.header,
    rules.map((rule) => [
      conditionText(rule, labels.and),
      labels.evidence(rule),
      rule.reason,
      rule.pages.map(pathOf).join(", "),
      String(rule.coveredValueCount),
      rule.exampleValues.join(", "),
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

/** A file name from the application name: letters, digits and dashes only. */
export function exportFileName(applicationName: string, extension: string) {
  const base =
    applicationName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") ||
    "application";
  return `apty-dom-config-${base}.${extension}`;
}
