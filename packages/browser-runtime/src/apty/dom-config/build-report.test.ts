import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capture,
  page,
  profile,
  run,
  type Values,
  values,
} from "./__tests__/fixtures";
import { pmdCapture } from "./__tests__/pmd-fixture";
import { buildDomConfigReport } from "./build-report";
import { classifyPage } from "./classify";
import { diffPageRuns } from "./diff-runs";
import { flattenRun } from "./flatten";
import { noisePolicy } from "./noise";
import { renderConditions, renderDomConfigMarkdown } from "./render-markdown";
import type {
  ApplicationCapture,
  DomConfigReport,
  RuleCondition,
  WarningCode,
} from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

const conditionText = (conditions: RuleCondition[]) =>
  conditions.map((c) => `${c.category} ${c.operator} ${c.value}`).join(" AND ");

describe("Appendix C (pMD) golden capture", () => {
  const report = buildDomConfigReport(pmdCapture(), {
    coverage: { "list-grid-pages": "captured" },
  });
  const main = report.rules
    .filter((r) => r.group === "main")
    .map((r) => conditionText(r.conditions));

  it("finds the generated ids, the timestamps and the changing dates", () => {
    expect(main).toEqual([
      "Attribute Name Equals id AND Attribute Value Regex ^ui-id-\\d+$",
      "Attribute Name Equals autocomplete AND Attribute Value Regex ^off_\\d+$",
      "Attribute Name Equals href AND Attribute Value Contains nocache",
      "Attribute Name Equals href AND Attribute Value Contains visitDate",
    ]);
    const nocache = report.rules.find(
      (r) => r.conditions[1]?.value === "nocache",
    );
    expect(nocache).toMatchObject({
      evidence: "observed_change",
      confidence: "set-diff",
    });
    expect(nocache!.pages).toHaveLength(19);
  });

  it("makes no rule from Apty's own elements and lists them as noise", () => {
    const text = JSON.stringify(report.rules);
    expect(text).not.toMatch(/apty/i);
    expect(report.noise.map((n) => n.matcher)).toEqual(
      expect.arrayContaining([
        "tag:apty-widget",
        "tag:apty-content-items",
        "tag:apty-focus-footer",
        "class:apty-",
        "attribute:data-apty-",
        "id:jumpcloud",
        "attribute:data-myki-",
        "style:z-index>=999999",
      ]),
    );
    expect(report.warnings.map((w) => w.code)).toContain("apty-inconsistent");
  });

  it("reports provCheck ids, style and tabindex as already ignored by Apty's defaults", () => {
    expect(
      report.coveredByDefaults.map((c) => [
        c.name,
        c.generalized,
        c.defaultRule,
      ]),
    ).toEqual([
      ["id", "^provCheck_\\d+$", "id-for-digits"],
      ["style", null, "attribute-name"],
      ["tabindex", null, "attribute-name"],
    ]);
  });

  it("proposes id,name,col-id,placeholder,data-ref,href and shows it against Apty's default", () => {
    expect(report.attributePriority.value).toBe(
      "id,name,col-id,placeholder,data-ref,href",
    );
    expect(
      report.attributePriority.diff.filter((d) => d.proposedPosition === null),
    ).toEqual([
      { name: "class", proposedPosition: null, defaultPosition: 2 },
      { name: "src", proposedPosition: null, defaultPosition: 4 },
    ]);
    expect(report.warnings.map((w) => w.code)).toContain("no-test-attributes");
  });

  it("keeps the extension's 999999 out of the z-index and its frame out of the frames to handle", () => {
    expect(report.maxZIndex).toMatchObject({
      value: 2147483646,
      appMax: 9999,
      basis: "derived",
    });
    expect(report.maxZIndex.excluded.map((e) => e.value)).toEqual([999999]);
    expect(report.iframes).toEqual([
      expect.objectContaining({
        src: "chrome-extension://abcdefghijklmnop/login.html",
        kind: "extension",
        needsHandling: false,
        analyzed: false,
      }),
    ]);
  });

  it("names the weak selectors, RptTable first", () => {
    expect(
      report.weakSelectors.slice(0, 5).map((w) => [w.selector, w.maxPerPage]),
    ).toEqual([
      [".RptTable", 185],
      [".subBodytext", 14],
      [".group-item", 6],
      [".modifier-row", 4],
      ['[name="delete"]', 3],
    ]);
    expect(report.weakSelectors.map((w) => w.selector)).toContain(
      '[name="npi"]',
    );
  });

  it("ends with what was not captured, from the SE's coverage answers", () => {
    expect(report.coverage.notCaptured).toEqual(
      expect.arrayContaining(["entry-forms", "detail-pages", "modals-dialogs"]),
    );
    expect(report.coverage.notCaptured).not.toContain("list-grid-pages");
    expect(renderDomConfigMarkdown(report)).toMatch(
      /## Not captured\n\n(- [a-z-]+\n)+$/,
    );
  });
});

function reversed<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reversed).reverse() as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([k, v]) => [k, reversed(v)]),
    ) as T;
  }
  return value;
}

describe("determinism (D9)", () => {
  it("gives byte-identical output whatever order pages, runs and keys arrive in, without a clock or randomness", () => {
    const now = vi.spyOn(Date, "now");
    const random = vi.spyOn(Math, "random");
    const input = pmdCapture();
    const shuffled: ApplicationCapture = {
      applicationName: input.applicationName,
      pages: reversed(input.pages),
    };
    const a = buildDomConfigReport(input);
    const b = buildDomConfigReport(shuffled);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(renderDomConfigMarkdown(b)).toBe(renderDomConfigMarkdown(a));
    expect(now).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it("takes capture dates only from the input", () => {
    const report = buildDomConfigReport(
      capture([page("p", [run("initial", profile({}))])]),
    );
    expect(report.captureDates).toEqual([]);
    expect(report.pages[0]!.runs[0]!.capturedAt).toBeNull();
  });
});

describe("privacy (D2, D3, D11)", () => {
  const PII = ["jane.doe@example.com", "555-123-4567", "00012345678"];
  const first: Record<string, Values> = {
    title: values("jane.doe@example.com"),
    "data-phone": values("555-123-4567"),
    "data-mrn": values("MRN 00012345678"),
    "data-patient": values("Jane Doe"),
    id: values("save"),
  };

  it("stores no email, phone number or digit run anywhere; person names are not detected, so one can reach a diff but never a rule, example or the Markdown", () => {
    const report = buildDomConfigReport(
      capture([
        page("p1", [
          run("initial", profile(first), {
            urlShape: "/patients/1234567?mrn=00012345678",
          }),
          run(
            "after-reload",
            profile({ ...first, "data-patient": values("John Roe") }),
          ),
        ]),
      ]),
    );
    const json = JSON.stringify(report);
    const markdown = renderDomConfigMarkdown(report);
    for (const value of PII) {
      expect(json).not.toContain(value);
      expect(markdown).not.toContain(value);
    }
    expect(report.pages[0]!.runs[0]!.urlShape).toBe("/patients/:id?mrn");
    expect(JSON.stringify(report.rules)).not.toContain("Jane");
    expect(markdown).not.toContain("Jane");
    expect(JSON.stringify(report.pages[0]!.diffs)).toContain("Jane Doe");
    expect(report.piiCounts).toEqual({ email: 1, phone: 1, digits: 1 });
  });
});

/** Every rule row of the Ignore conditions tables, parsed back into conditions. */
function markdownRules(markdown: string): RuleCondition[][] {
  const section = markdown.slice(
    markdown.indexOf("## Ignore conditions"),
    markdown.indexOf("### Already ignored"),
  );
  const condition =
    /(Attribute Name|Attribute Value) · ([A-Za-z ]+?) · `((?:[^`\\]|\\.)*)`/g;
  return section
    .split("\n")
    .filter((line) => line.startsWith("| ") && line.includes("Attribute "))
    .map((line) =>
      [...line.matchAll(condition)].map((m) => ({
        category: m[1] as RuleCondition["category"],
        operator: m[2] as RuleCondition["operator"],
        value: m[3]!.replace(/\\\|/g, "|"),
      })),
    );
}

function markdownSettings(markdown: string): Map<string, [string, string]> {
  const section = markdown.slice(
    markdown.indexOf("## Settings"),
    markdown.indexOf("### Excluded"),
  );
  return new Map(
    section
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Setting"))
      .map((line) => {
        const [name, value, basis] = line.slice(2, -2).split(" | ");
        return [name!, [value!, basis!]];
      }),
  );
}

describe("Markdown", () => {
  const withAlternation = buildDomConfigReport(
    capture([
      page("p1", [
        run(
          "initial",
          profile({ id: values("ui-id-1", "ui-id-2", "ui-tab-1", "ui-tab-2") }),
        ),
        run(
          "after-reload",
          profile({ id: values("ui-id-1", "ui-id-2", "ui-tab-1", "ui-tab-2") }),
        ),
      ]),
    ]),
  );

  it("agrees with the structured report on every rule and setting", () => {
    for (const report of [
      buildDomConfigReport(pmdCapture()),
      withAlternation,
    ]) {
      const markdown = renderDomConfigMarkdown(report);
      expect(markdownRules(markdown)).toEqual(
        report.rules.map((r) => r.conditions),
      );
      const settings = markdownSettings(markdown);
      expect(settings.get("Enable Shadow DOM support")).toEqual([
        report.shadowDom.value ? "On" : "Off",
        report.shadowDom.basis,
      ]);
      expect(settings.get("DOM change debounce")).toEqual([
        `${report.debounce.value} ms`,
        report.debounce.basis,
      ]);
      expect(settings.get("Max z-index")).toEqual([
        String(report.maxZIndex.value),
        report.maxZIndex.basis,
      ]);
      expect(markdown).toContain(`\`${report.attributePriority.value}\``);
      expect(markdown).toContain(report.toolVersion);
      expect(markdown).toContain(report.ruleListVersion);
    }
  });

  /** A row's cells as GitHub-flavored Markdown splits them: a backslash escapes the next character, an unescaped pipe ends a cell. */
  const gfmCells = (row: string) =>
    (
      row
        .trim()
        .slice(1)
        .match(/(?:\\.|[^|\\])*\|/g) ?? []
    ).map((c) => c.slice(0, -1).trim());

  it("keeps a table's columns when a page name or a value has a backslash before a pipe", () => {
    const report = buildDomConfigReport(
      capture([page("p1", [run("initial", profile({}))], "Visits \\| old")]),
    );
    const pageRow = renderDomConfigMarkdown(report)
      .split("\n")
      .find((line) => line.startsWith("| Visits"));
    expect(gfmCells(pageRow!)).toHaveLength(4);
    const rule = {
      ...withAlternation.rules[0]!,
      conditions: [
        {
          category: "Attribute Value" as const,
          operator: "Regex" as const,
          value: "^a\\|b$",
        },
      ],
    };
    expect(gfmCells(`| ${renderConditions(rule)} |`)).toHaveLength(1);
  });

  it("escapes a pattern's | only as the table requires, so the pattern itself keeps a plain |", () => {
    const [rule] = withAlternation.rules;
    expect(rule!.conditions[1]!.value).toBe("^ui-(?:id-\\d+|tab-\\d+)$");
    expect(renderConditions(rule!)).toContain("^ui-(?:id-\\d+\\|tab-\\d+)$");
  });
});

function warningCodes(report: DomConfigReport): WarningCode[] {
  return report.warnings.map((w) => w.code).sort();
}

describe("warnings", () => {
  it("raises each warning from the capture that causes it", () => {
    const base = {
      class: values(["RptTable", 3]),
      "data-qa-id": values("save"),
    };
    const report = buildDomConfigReport(
      capture([
        page("a", [
          run(
            "initial",
            profile({
              ...base,
              id: values("row-1", "row-2", "provCheck_1009116120"),
            }),
          ),
          run(
            "after-reload",
            profile(
              {
                ...base,
                id: values("row-1", "row-2", "provCheck_1009116120"),
                title: values("x".repeat(600)),
              },
              { tags: { "apty-widget": 1, div: 2001 } },
            ),
          ),
          run("repeat", profile(base), { stateMismatch: true }),
        ]),
        page("b", [
          run(
            "initial",
            profile({ id: values("row-3"), title: values("a@example.com") }),
          ),
          run(
            "after-reload",
            profile({ id: values("row-3"), title: values("a@example.com") }),
          ),
          run(
            "repeat",
            profile(
              {},
              {
                schema: 2,
                shadow: [{ hostTag: "x-secure", mode: "closed" }],
                meta: { partial: true },
              },
            ),
          ),
        ]),
        page("c", [run("initial", profile({}))]),
      ]),
    );
    expect(warningCodes(report)).toEqual(
      [
        "apty-inconsistent",
        "closed-shadow-roots",
        "covered-by-defaults",
        "incomplete-capture",
        "large-dom",
        "legacy-closed-shadow-roots",
        "names-not-detected",
        "no-test-attributes",
        "pii-values",
        "rejected-rules",
        "single-run-pages",
        "state-mismatch",
        "truncated",
        "unconfirmed-noise",
        "weak-selectors",
      ].sort(),
    );
    expect(report.unreadyPages).toEqual([
      { pageId: "a", label: "a", reason: "unreliable" },
      { pageId: "b", label: "b", reason: "unreliable" },
      { pageId: "c", label: "c", reason: "single-run" },
    ]);
    expect(report.unconfirmedNoise).toEqual([
      { marker: "data-qa*", count: 1, pages: ["a"] },
    ]);
    expect(report.notMeasured.map((n) => n.item)).toEqual(
      expect.arrayContaining([
        "DOM change debounce",
        "Ignore DOM events",
        "Container score threshold",
        "Click-advance",
        "Unconfirmed noise",
      ]),
    );
  });

  it("says when rules beyond the limit were left out", () => {
    const letters = (i: number) =>
      i.toString(26).replace(/\d/g, (d) => "qrstuvwxyz"[Number(d)]!);
    const many: Record<string, Values> = {};
    for (let i = 0; i < 401; i++) {
      many[`data-${letters(i)}`] = values(`${letters(i)}-1`, `${letters(i)}-2`);
    }
    const report = buildDomConfigReport(
      capture([
        page("p", [
          run("initial", profile(many)),
          run("after-reload", profile(many)),
        ]),
      ]),
    );
    expect(report.rules).toHaveLength(400);
    expect(report.warnings.find((w) => w.code === "rule-cap")).toMatchObject({
      count: 1,
    });
  });
});

describe("size limits (D10)", () => {
  const huge: Values = {};
  for (let i = 0; i < 100_000; i++) huge[`row-key-${i}-${i % 7}`] = 1;

  it("classifies an attribute with 100,000 values quickly", () => {
    const policy = noisePolicy();
    const flats = [
      run("initial", profile({})),
      run("after-reload", profile({})),
    ].map((r) => flattenRun(r, policy));
    for (const flat of flats)
      flat.attributes.set("data-key", new Map(Object.entries(huge)));
    const started = performance.now();
    const diff = diffPageRuns(flats, policy);
    const classified = classifyPage("p", "p", flats, diff, policy);
    expect(classified.items).toHaveLength(100_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("keeps the most frequent values within the cap and reports what it cut", () => {
    const started = performance.now();
    const report = buildDomConfigReport(
      capture([
        page("p", [
          run("initial", profile({ "data-key": huge })),
          run("after-reload", profile({ "data-key": huge })),
        ]),
      ]),
    );
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(report.truncations).toEqual([
      {
        pageId: "p",
        run: 0,
        kind: "distinct-values",
        name: "data-key",
        dropped: 95_000,
      },
      {
        pageId: "p",
        run: 1,
        kind: "distinct-values",
        name: "data-key",
        dropped: 95_000,
      },
    ]);
    expect(report.warnings.map((w) => w.code)).toContain("truncated");
  });
});
