import { describe, expect, it } from "vitest";
import {
  CARD_PAGE_ID,
  diagnoseContentNotVisible,
  VERIFIED_ON,
} from "./content-not-visible";
import { type Capture, capture, evidenceFrom } from "./diagnosis-test-utils";
import type {
  ClientEvidence,
  DiagnosisResult,
  FileStatus,
  GateId,
} from "./types";

type Item = Record<string, unknown> & {
  sourceId: string;
  locales: Array<Record<string, unknown>>;
};

function check(query?: string, files: Capture = capture()) {
  return diagnoseContentNotVisible(evidenceFrom(files), "workflow", query);
}

function gateOf(result: DiagnosisResult, id: GateId) {
  return result.gates.find((g) => g.id === id);
}

function edit(files: Capture, name: string, change: (json: never) => unknown) {
  return { ...files, [name]: change(files[name] as never) };
}

const workflows = (files: Capture) => files["workflow.json"] as Item[];
const sourceIdOf = (files: Capture, name: string) =>
  workflows(files).find((w) => w.locales[0]?.name === name)?.sourceId ?? "";

describe("content-not-visible: a workflow that is in the files", () => {
  it("passes every gate it can decide and leaves the user's segment to the browser", () => {
    const result = check("Create a lead");

    expect(result.verdict.status).toBe("candidates");
    expect(result.verdict.causes).toEqual([]);
    expect(result.verdict.nextCheck).toBe("testAsMember");
    expect(result.gates.map((g) => `${g.id}:${g.status}:${g.reason}`)).toEqual([
      "data:pass:filesRead",
      "environment:info:envLoaded",
      "published:pass:found",
      "flags:pass:flagsOk",
      "segments:unknown:mustMatch",
      "widget-audience:unknown:widgetLimited",
      "visibility-rule:pass:noVisibilityRule",
    ]);
    expect(gateOf(result, "environment")?.params).toEqual({
      env: "UAT",
      order: "2",
    });
    expect(gateOf(result, "segments")?.params).toEqual({
      segments: "Sales team",
    });
    expect(gateOf(result, "widget-audience")?.params).toEqual({
      segments: "Sales team, New hires",
    });
    expect(result.subject.matched).toEqual(["Create a lead (0c000000)"]);
    expect(result.confidence).toBe("likely");
    expect(result.notChecked).toEqual(["membership", "runtime-rules"]);
    expect(result.cardPageId).toBe(CARD_PAGE_ID);
    expect(result.verifiedOn).toBe(VERIFIED_ON);
  });

  it("names Hide from widget as the cause, citing the card", () => {
    const result = check("Take a tour");

    expect(result.verdict.status).toBe("cause_found");
    expect(result.verdict.causes).toHaveLength(1);
    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "CNV-03",
      cardPageId: "1496842241",
      params: { kind: "workflow", name: "Take a tour" },
      evidence: ["workflow.json: hideFromWidget = true"],
    });
    expect(result.verdict.nextCheck).toBe("openItems");
  });

  it("finds an item by sourceId, exact name first, then by part of its name", () => {
    const files = capture();
    expect(check(sourceIdOf(files, "Take a tour")).subject.matched).toEqual([
      "Take a tour (0c000000)",
    ]);
    expect(check("request activities").subject.matched).toHaveLength(1);
    expect(check("qualify").subject.matched).toEqual([
      "Qualify a lead (0c000000)",
    ]);
  });

  it("treats an item no segment lists as visible to everyone", () => {
    const result = check("Request activities");

    expect(gateOf(result, "segments")).toMatchObject({
      status: "pass",
      reason: "noSegments",
      ruleId: "CNV-06",
    });
    expect(result.verdict.status).toBe("candidates");
  });

  it("reports no cause in the data when the files leave nothing open", () => {
    const files = edit(capture(), "app-data.json", (appData: Capture) => ({
      ...appData,
      config: { widgetConfig: { display: "All", selectedSegments: [] } },
    }));

    const result = check("Request activities", files);

    expect(gateOf(result, "widget-audience")?.reason).toBe("widgetForAll");
    expect(result.verdict).toMatchObject({
      status: "no_cause_in_data",
      nextCheck: "sendSupport",
      causes: [],
    });
  });

  it("finds an item linked only to turned-off segments hidden from everyone", () => {
    const result = check("Export a report");

    expect(result.verdict.causes.map((c) => c.ruleId)).toEqual(["CNV-07"]);
    expect(result.verdict.causes[0]?.cardPageId).toBe("1496612886");
    expect(result.verdict.causes[0]?.params.segments).toBe("Retired team");
  });

  it("finds a segment whose rule is missing from rule.json", () => {
    const result = check("Close an opportunity");

    expect(result.verdict.causes.map((c) => c.ruleId)).toEqual(["CNV-08"]);
    expect(gateOf(result, "segments")?.evidence).toEqual([
      "Partners: isActive true, rule missing in rule.json",
    ]);
  });

  it("finds a feedback message missing in a language", () => {
    const result = check("Update an account");

    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "CNV-05",
      params: { field: "feedbackMessage", languages: "en" },
    });
  });

  it("finds a missing success message too", () => {
    const files = edit(capture(), "workflow.json", (list: Item[]) =>
      list.map((w) =>
        w.locales[0]?.name === "Create a lead"
          ? { ...w, locales: [{ ...w.locales[0], successMessage: "" }] }
          : w,
      ),
    );

    expect(check("Create a lead", files).verdict.causes[0]?.params.field).toBe(
      "successMessage",
    );
  });

  it("finds an item with no name in any language", () => {
    const files = capture();
    const id = sourceIdOf(files, "Merge contacts");
    const nameless = edit(files, "workflow.json", (list: Item[]) =>
      list.map((w) =>
        w.sourceId === id ? { ...w, locales: [{ locale: "en", name: "" }] } : w,
      ),
    );

    const result = check(id, nameless);

    expect(result.verdict.causes.map((c) => c.ruleId)).toEqual(["CNV-04"]);
  });

  it("lists a visibility rule by name and leaves its result to the browser", () => {
    const result = check("Qualify a lead");

    expect(gateOf(result, "visibility-rule")).toMatchObject({
      status: "unknown",
      params: { rule: "On a lead page", action: "SHOW" },
      evidence: ["rule summary: Require that the page is a lead record."],
    });
  });

  it("notes a segment link that only one side records", () => {
    const result = check("Request a quote");

    expect(gateOf(result, "segment-consistency")).toMatchObject({
      status: "info",
      ruleId: "CNV-10",
      params: { count: 1 },
    });
  });

  it("flags a widget limited to other segments as open, since a user can be in both (P4)", () => {
    const files = capture();
    const newHires = (files["segment.json"] as Item[])[1]?.id;
    const limited = edit(files, "app-data.json", (appData: Capture) => ({
      ...appData,
      config: {
        widgetConfig: { display: "Specific", selectedSegments: [newHires] },
      },
    }));

    const result = check("Create a lead", limited);

    expect(gateOf(result, "widget-audience")).toMatchObject({
      status: "unknown",
      reason: "widgetDisjoint",
      params: { segments: "New hires", itemSegments: "Sales team" },
    });
    expect(result.verdict.status).toBe("candidates");
    expect(result.verdict.causes).toEqual([]);
  });

  it("does not add the widget's audience to a segment that can never match", () => {
    const result = check("Export a report");

    expect(gateOf(result, "widget-audience")?.reason).toBe("widgetLimited");
  });
});

describe("content-not-visible: a workflow that is not in the files", () => {
  it("says it is not published here, and that a segment still points at it", () => {
    const archived = "0c000000-0000-7000-8000-000000000009";

    const result = check(archived);

    expect(result.verdict.status).toBe("cause_found");
    expect(result.verdict.causes[0]?.ruleId).toBe("CNV-02");
    expect(result.verdict.causes[0]?.evidence).toEqual([
      `workflow.json: 9 entries, none match "${archived}"`,
      "segment.json still lists sourceId 0c000000",
      "1 workflow ID(s) listed in segment.json are not in workflow.json",
    ]);
    expect(result.verdict.nextCheck).toBe("reload");
  });

  it("asks which one when a name matches several items", () => {
    const result = check("Request");

    expect(result.verdict).toMatchObject({
      status: "candidates",
      causes: [],
      nextCheck: "whichOne",
    });
    expect(result.subject.matched).toEqual([
      "Request activities (0c000000)",
      "Request a quote (0c000000)",
    ]);
  });
});

describe("content-not-visible: no item named", () => {
  it("leaves segment blockers open when segment.json could not be read, instead of counting none (7)", () => {
    const files = edit(capture(), "workflow.json", (items: Item[]) =>
      items.map((item) => ({ ...item, hideFromWidget: false })),
    );
    const evidence = evidenceFrom(files);
    evidence.files["segment.json"] = { name: "segment.json", status: "failed" };

    const result = diagnoseContentNotVisible(evidence, "workflow");

    expect(result.scan?.segmentsUnread).toBe(true);
    expect(gateOf(result, "segments")).toMatchObject({
      status: "unknown",
      reason: "segmentsUnread",
    });
    expect(result.verdict.status).toBe("candidates");
    expect(result.verdict.headline).toMatch(/segment\.json could not be read/);
  });

  it("lists the blockers the files show for every item", () => {
    const result = check();

    expect(result.scan?.total).toBe(9);
    expect(
      result.scan?.rows
        .filter((r) => r.blockers.length > 0)
        .map((r) => [r.name, r.blockers]),
    ).toEqual([
      ["Take a tour", ["hidden"]],
      ["Export a report", ["inactive-segments"]],
    ]);
    expect(result.verdict).toMatchObject({
      status: "candidates",
      nextCheck: "nameItem",
    });
    expect(result.verdict.headline).toMatch(/^2 of 9 workflows/);
  });
});

describe("content-not-visible: when the data is not there", () => {
  it("reports an unreachable Client as no data, never as a finding", () => {
    const evidence: ClientEvidence = {
      connection: {
        ok: false,
        failure: "no_receiver",
        message: "Chrome found nothing listening.",
      },
      observedNames: [],
      files: {},
    };

    const result = diagnoseContentNotVisible(evidence, "workflow", "x");

    expect(result.verdict).toMatchObject({
      status: "no_data",
      causes: [],
      nextCheck: "fixConnection",
    });
    expect(result.gates[0]?.reason).toBe("clientUnreachable");
  });

  it("refuses to judge a 4.x tenant", () => {
    const result = diagnoseContentNotVisible(
      evidenceFrom(capture("content-4x")),
      "workflow",
      "Create a lead",
    );

    expect(result.verdict).toMatchObject({
      status: "out_of_scope",
      nextCheck: "manual4x",
    });
    expect(result.gates[0]?.reason).toBe("version4x");
  });

  const problems: Array<[FileStatus, string, string]> = [
    ["not_observed", "notObserved", "reload"],
    ["empty", "emptyList", "readStatus"],
    ["http_error", "httpError", "fixRequest"],
    ["failed", "requestFailed", "fixRequest"],
    ["pending", "pending", "waitForLoad"],
    ["body_denied", "denied", "denyList"],
    ["body_unavailable", "bodyUnavailable", "bodyLimit"],
    ["too_large_to_redact", "bodyUnavailable", "bodyLimit"],
    ["unparsable", "unparsable", "openResponse"],
  ];
  for (const [status, reason, next] of problems) {
    it(`names a workflow.json that is ${status}`, () => {
      const evidence = evidenceFrom(capture());
      evidence.files["workflow.json"] = {
        name: "workflow.json",
        status,
        httpStatus: status === "http_error" ? 403 : 200,
        detail: status === "body_denied" ? "/workflow.json" : undefined,
      };

      const result = diagnoseContentNotVisible(evidence, "workflow", "x");

      expect(result.verdict.status).toBe("no_data");
      expect(result.verdict.causes).toEqual([]);
      expect(result.verdict.nextCheck).toBe(next);
      expect(result.gates[0]?.reason).toBe(reason);
      expect(result.files[0]).toMatchObject({ name: "workflow.json", status });
    });
  }

  it("names the deny-list entry and the HTTP status in the text", () => {
    const evidence = evidenceFrom(capture());
    evidence.files["workflow.json"] = {
      name: "workflow.json",
      status: "body_denied",
      detail: "apty.example",
    };
    expect(
      diagnoseContentNotVisible(evidence, "workflow", "x").verdict.headline,
    ).toMatch(/deny list entry "apty\.example"/);

    evidence.files["workflow.json"] = {
      name: "workflow.json",
      status: "http_error",
      httpStatus: 403,
    };
    expect(
      diagnoseContentNotVisible(evidence, "workflow", "x").gates[0]?.params,
    ).toEqual({ file: "workflow.json", httpStatus: 403 });
  });

  it("keeps going without the supporting files, and says what it could not read", () => {
    const evidence = evidenceFrom(capture());
    delete evidence.files["segment.json"];
    delete evidence.files["app-data.json"];
    delete evidence.files["app-urls.json"];

    const result = diagnoseContentNotVisible(
      evidence,
      "workflow",
      "Create a lead",
    );

    expect(gateOf(result, "segments")?.reason).toBe("segmentsUnread");
    expect(gateOf(result, "widget-audience")?.reason).toBe("appDataUnread");
    expect(gateOf(result, "environment")?.reason).toBe("envUnknown");
    expect(result.verdict.status).toBe("candidates");
  });
});

describe("content-not-visible: the other content kinds", () => {
  it("uses the same gates for a tooltip, and finds a link to an unpublished one", () => {
    const evidence = evidenceFrom(capture());

    expect(
      diagnoseContentNotVisible(evidence, "tooltip", "Lead source help").verdict
        .status,
    ).toBe("candidates");
    const missing = diagnoseContentNotVisible(
      evidence,
      "tooltip",
      "0b000000-0000-7000-8000-000000000009",
    );
    expect(missing.verdict.causes[0]?.ruleId).toBe("CNV-02");
    expect(missing.verdict.causes[0]?.evidence).toContain(
      "segment.json still lists sourceId 0b000000",
    );
  });

  it("finds hidden knowledge content and checks launchers, announcements, validations and checklists", () => {
    const evidence = evidenceFrom(capture());

    expect(
      diagnoseContentNotVisible(evidence, "knowledgeContent", "Sales playbook")
        .verdict.causes[0]?.ruleId,
    ).toBe("CNV-03");
    for (const [kind, name] of [
      ["launcher", "Start: Create a lead"],
      ["announcement", "Quarter close reminder"],
      ["validation", "Email format"],
      ["checklist", "Getting started"],
    ] as const) {
      const result = diagnoseContentNotVisible(evidence, kind, name);
      expect(result.subject.matched).toHaveLength(1);
      expect(result.gates.find((g) => g.id === "published")?.status).toBe(
        "pass",
      );
    }
  });
});

it("gives the same result for the same files (P8)", () => {
  expect(JSON.stringify(check("Create a lead"))).toBe(
    JSON.stringify(check("Create a lead")),
  );
});

describe("content-not-visible: the language the message named", () => {
  const withLocales = (codes: string[]) =>
    edit(capture(), "workflow.json", (items: Item[]) =>
      items.map((w) =>
        w.locales[0]?.name === "Create a lead"
          ? {
              ...w,
              locales: codes.map((locale) => ({ ...w.locales[0], locale })),
            }
          : w,
      ),
    );
  const inLanguage = (files: Capture, language: string) =>
    diagnoseContentNotVisible(
      evidenceFrom(files),
      "workflow",
      "Create a lead",
      language,
    );

  it("finds an item with no name in that language, citing the translation card", () => {
    const result = inLanguage(capture(), "fr");

    expect(result.subject.language).toBe("fr");
    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "CNV-13",
      cardPageId: "1496678461",
      summary:
        '"Create a lead" has no name in French (fr), so the widget drops it for French users.',
    });
    expect(gateOf(result, "language")?.evidence).toEqual([
      "workflow.json: names in en",
    ]);
  });

  it("leaves a regional entry open, since it does not stand in for the plain code", () => {
    const result = inLanguage(withLocales(["en", "fr-CA"]), "fr");

    expect(gateOf(result, "language")).toMatchObject({
      status: "unknown",
      reason: "localeRegional",
      params: { language: "French", code: "fr", locales: "fr-CA" },
    });
    expect(result.verdict.causes).toEqual([]);
  });

  it("leaves an entry under an older code for the language open, not a missing name (14)", () => {
    for (const [code, older] of [
      ["he", "iw"],
      ["id", "in"],
      ["no", "nb"],
    ]) {
      const result = inLanguage(withLocales(["en", older]), code);

      expect(gateOf(result, "language")).toMatchObject({
        status: "unknown",
        reason: "localeAlias",
        params: { code, locales: older },
      });
      expect(result.verdict.causes).toEqual([]);
    }
  });

  it("passes when the item is named in that language", () => {
    const result = inLanguage(withLocales(["en", "fr"]), "fr");

    expect(gateOf(result, "language")?.status).toBe("pass");
    expect(result.verdict.causes).toEqual([]);
  });

  it("adds no language gate when the message named no language", () => {
    expect(gateOf(check("Create a lead"), "language")).toBeUndefined();
  });
});
