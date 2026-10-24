/**
 * The report as Markdown tables mirroring Apty's DOM Settings screen
 * (R1.8). It renders only what the structured report holds, so the two
 * agree on every rule and setting. Inside a table a `|` is written `\|`,
 * as GitHub-flavored Markdown requires; copy patterns from the side panel
 * or the JSON export rather than from the raw Markdown text.
 */
import type {
  DomConfigReport,
  Rule,
  RuleCondition,
  RuleGroup,
  RuleTarget,
  Setting,
} from "./types.js";
import { DEFAULTS_ASSUMPTION } from "./warnings.js";

/** Plain text in a table cell: a backslash or a pipe is escaped, so neither can end the cell. */
function cell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/[\\|]/g, "\\$&");
}

/**
 * A code span in a table cell. A backslash is literal in a code span, so a
 * pattern's `\d` stays as written; only a pipe, and a backslash right before
 * one, are escaped to keep the table's columns.
 */
function code(text: string): string {
  return `\`${text.replace(/\r?\n/g, " ").replace(/\\(?=\|)|\|/g, "\\$&")}\``;
}

function table(header: string[], rows: string[][]): string[] {
  if (rows.length === 0) return ["None.", ""];
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
  ];
}

const MAX_LISTED_PAGES = 5;

function pagesText(report: DomConfigReport, ids: readonly string[]): string {
  const order = new Map(report.pages.map((p, i) => [p.pageId, i]));
  const names = [...ids]
    .sort((a, b) => (order.get(a) ?? -1) - (order.get(b) ?? -1))
    .map((id) => report.pages[order.get(id) ?? -1]?.label ?? id);
  const shown = names.slice(0, MAX_LISTED_PAGES).join(", ");
  const more = names.length - MAX_LISTED_PAGES;
  return cell(more > 0 ? `${shown} and ${more} more` : shown);
}

function renderCondition(condition: RuleCondition): string {
  return `${condition.category} · ${condition.operator} · ${code(condition.value)}`;
}

export function renderConditions(rule: Rule): string {
  return rule.conditions.map(renderCondition).join(" AND ");
}

function ruleRows(
  report: DomConfigReport,
  rules: Rule[],
  withTarget: boolean,
): string[][] {
  return rules.map((rule) => [
    ...(withTarget ? [TARGET_TITLES[rule.target]] : []),
    renderConditions(rule),
    rule.evidence,
    rule.confidence,
    pagesText(report, rule.pages),
    String(rule.coveredValueCount),
    rule.exampleValues.map(code).join(", ") || "none",
    cell(rule.reason),
  ]);
}

const RULE_HEADER = [
  "Conditions",
  "Evidence",
  "Confidence",
  "Pages",
  "Values covered",
  "Examples",
  "Reason",
];

const TARGET_TITLES: Record<RuleTarget, string> = {
  id: "IDs",
  class: "Classes",
  "attribute-name": "Attributes by name",
  "attribute-value": "Attributes by value",
};

const GROUP_TITLES: Record<Exclude<RuleGroup, "main">, string> = {
  review: "Need review (heuristic; include only after checking)",
  "record-specific": "Guides target a specific record (off by default)",
};

function settingRow(
  name: string,
  value: string,
  setting: Pick<Setting<unknown>, "basis" | "reason">,
): string[] {
  return [name, cell(value), setting.basis, cell(setting.reason)];
}

export function renderDomConfigMarkdown(report: DomConfigReport): string {
  const lines: string[] = [];
  const out = (...more: string[]) => lines.push(...more);

  out(`# DOM configuration: ${cell(report.applicationName)}`, "");
  out(
    ...table(
      ["Field", "Value"],
      [
        ["Tool version", code(report.toolVersion)],
        ["Rule-list version", code(report.ruleListVersion)],
        [
          "Capture dates",
          cell(report.captureDates.join(", ") || "not recorded"),
        ],
        ["Pages", String(report.pages.length)],
      ],
    ),
  );

  out("## Pages", "");
  out(
    ...table(
      ["Page", "Status", "Runs", "Path"],
      report.pages.map((page) => [
        cell(page.label),
        page.status,
        page.runs.map((r) => r.label).join(", "),
        cell(page.runs.find((r) => r.urlShape)?.urlShape ?? "not recorded"),
      ]),
    ),
  );
  out("### Unready pages", "");
  out(
    ...table(
      ["Page", "Reason"],
      report.unreadyPages.map((p) => [cell(p.label), p.reason]),
    ),
  );

  out("## Ignore conditions", "");
  const main = report.rules.filter((r) => r.group === "main");
  for (const target of Object.keys(TARGET_TITLES) as RuleTarget[]) {
    out(`### ${TARGET_TITLES[target]}`, "");
    out(
      ...table(
        RULE_HEADER,
        ruleRows(
          report,
          main.filter((r) => r.target === target),
          false,
        ),
      ),
    );
  }
  for (const group of ["review", "record-specific"] as const) {
    out(`### ${GROUP_TITLES[group]}`, "");
    out(
      ...table(
        ["Target", ...RULE_HEADER],
        ruleRows(
          report,
          report.rules.filter((r) => r.group === group),
          true,
        ),
      ),
    );
  }
  out(
    "### Already ignored by Apty's defaults",
    "",
    cell(DEFAULTS_ASSUMPTION),
    "",
  );
  out(
    ...table(
      [
        "Target",
        "Attribute",
        "Values",
        "Default rule",
        "Count",
        "Pages",
        "Examples",
      ],
      report.coveredByDefaults.map((c) => [
        TARGET_TITLES[c.target],
        code(c.name),
        c.generalized ? code(c.generalized) : "any",
        c.defaultRule,
        String(c.valueCount),
        pagesText(report, c.pages),
        c.exampleValues.map(code).join(", ") || "none",
      ]),
    ),
  );
  out("### Needs manual review", "");
  out(
    ...table(
      ["Target", "Attribute", "Reason", "Values", "Pages"],
      report.manualReview.map((m) => [
        TARGET_TITLES[m.target],
        code(m.name),
        cell(m.reason),
        String(m.valueCount),
        pagesText(report, m.pages),
      ]),
    ),
  );
  out("### Rejected rules", "");
  out(
    ...table(
      ["Conditions", "Evidence", "Reason"],
      report.rejectedRules.map((r) => [
        renderConditions(r.rule),
        r.rule.evidence,
        cell(r.reason),
      ]),
    ),
  );

  const priority = report.attributePriority;
  out(
    "## Attribute priority",
    "",
    `${code(priority.value)} (${priority.basis})`,
    "",
  );
  out(
    ...table(
      ["Position", "Attribute", "Reason"],
      priority.entries.map((e, i) => [
        String(i + 1),
        code(e.name),
        cell(e.reason),
      ]),
    ),
  );
  out(
    `### Compared with Apty's default priority (${code(priority.defaultPriority.join(","))})`,
    "",
  );
  out(
    ...table(
      ["Attribute", "Proposed", "Default"],
      priority.diff.map((d) => [
        code(d.name),
        d.proposedPosition === null
          ? "not proposed"
          : String(d.proposedPosition),
        d.defaultPosition === null
          ? "not in default"
          : String(d.defaultPosition),
      ]),
    ),
  );

  out("## Ignore DOM events", "");
  out(
    ...table(
      ["Events", "Basis", "Reason"],
      [
        [
          report.ignoreEvents.value.map(code).join(", ") || "none measured",
          report.ignoreEvents.basis,
          cell(report.ignoreEvents.reason),
        ],
      ],
    ),
  );

  const z = report.maxZIndex;
  const threshold = report.containerScoreThreshold;
  out("## Settings", "");
  out(
    ...table(
      ["Setting", "Value", "Basis", "Reason"],
      [
        settingRow(
          "Enable Shadow DOM support",
          report.shadowDom.value ? "On" : "Off",
          report.shadowDom,
        ),
        settingRow(
          "DOM change debounce",
          `${report.debounce.value} ms`,
          report.debounce,
        ),
        settingRow("Max z-index", String(z.value), z),
        settingRow(
          "Container score threshold",
          `${threshold.referenceConfigValue} (reference configurations) / ${threshold.reconstructedModelValue} (reconstructed model)`,
          threshold,
        ),
        settingRow("Click-advance", "keep Apty's value", report.clickAdvance),
      ],
    ),
  );
  out("### Excluded z-index values", "");
  out(
    ...table(
      ["Value", "Source", "Pages"],
      z.excluded.map((e) => [
        String(e.value),
        cell(e.source),
        pagesText(report, e.pages),
      ]),
    ),
  );

  out("## Iframes", "");
  out(
    ...table(
      [
        "Pages",
        "src",
        "Cross-origin",
        "Kind",
        "Analyzed",
        "Needs handling in Apty",
      ],
      report.iframes.map((f) => [
        pagesText(report, f.pages),
        code(f.src),
        f.crossOrigin === null ? "unknown" : f.crossOrigin ? "yes" : "no",
        f.kind,
        f.analyzed ? "yes" : cell(`no: ${f.reason}`),
        f.needsHandling ? "yes" : "no",
      ]),
    ),
  );

  out("## Weak selectors", "");
  out(
    ...table(
      ["Selector", "Most on one page", "Pages"],
      report.weakSelectors.map((w) => [
        code(w.selector),
        String(w.maxPerPage),
        pagesText(report, w.pages),
      ]),
    ),
  );

  out("## Warnings", "");
  for (const w of report.warnings) {
    out(
      `- **${w.severity}** ${cell(w.message)}${w.pages.length ? ` Pages: ${pagesText(report, w.pages)}.` : ""}`,
    );
  }
  out("");

  out("## Noise (excluded from rules, z-index and iframes)", "");
  out(
    ...table(
      ["Matcher", "Owner", "Values", "Pages"],
      report.noise.map((n) => [
        code(n.matcher),
        cell(n.owner),
        String(n.count),
        pagesText(report, n.pages),
      ]),
    ),
  );
  out("## Unconfirmed noise (not applied)", "");
  out(
    ...table(
      ["Marker", "Values", "Pages"],
      report.unconfirmedNoise.map((n) => [
        code(n.marker),
        String(n.count),
        pagesText(report, n.pages),
      ]),
    ),
  );
  out("## Truncations", "");
  out(
    ...table(
      ["Page", "Run", "Kind", "Attribute", "Dropped"],
      report.truncations.map((t) => [
        t.pageId ? pagesText(report, [t.pageId]) : "all",
        t.run < 0 ? "all" : String(t.run + 1),
        t.kind,
        t.name ? code(t.name) : "",
        String(t.dropped),
      ]),
    ),
  );

  out("## What was not measured", "");
  out(
    ...table(
      ["Item", "Note"],
      report.notMeasured.map((n) => [cell(n.item), cell(n.text)]),
    ),
  );
  out("## Assumptions", "");
  out(
    ...table(
      ["Code", "Assumption"],
      report.assumptions.map((a) => [a.code, cell(a.text)]),
    ),
  );
  out("## Open questions", "");
  for (const [i, q] of report.openQuestions.entries()) {
    out(`${i + 1}. ${cell(q)}`);
  }
  out("");

  out("## Coverage", "");
  out(
    ...table(
      ["State", "Status", "Suggested pages"],
      report.coverage.items.map((c) => [
        c.key,
        c.status,
        pagesText(report, c.candidates) || "none",
      ]),
    ),
  );
  out("## Not captured", "");
  if (report.coverage.notCaptured.length === 0) out("Nothing.");
  for (const key of report.coverage.notCaptured) out(`- ${key}`);
  out("");
  return lines.join("\n");
}
