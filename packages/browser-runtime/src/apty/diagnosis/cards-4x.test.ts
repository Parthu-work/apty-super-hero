import { describe, expect, it } from "vitest";
import { cardLayerOf } from "./card-layers";
import { CARD_4X, KNOWN_4X_CARD_IDS, NOT_A_4X_CARD } from "./cards-4x";
import { diagnoseContentNotVisible4x } from "./content-not-visible-4x";
import { capture, evidenceFrom } from "./diagnosis-test-utils";
import type { Rec } from "./pack-kit";
import type { DiagnosisResult } from "./types";
import { diagnoseWidgetNotVisible4x } from "./widget-not-visible-4x";

type Files = Record<string, unknown>;

function files4x(change?: (f: Files) => void) {
  const files = capture("content-4x");
  change?.(files);
  return evidenceFrom(files);
}
const UAT_PAGE = "https://uat.crm.example.com/leads/42";
const env0 = (f: Files) =>
  ((f["app-urls.json"] as Rec[])[0]?.environments as Rec[])[0] as Rec;

/** One verdict per 4.x rule's cause, from the synthetic 4.x fixture. */
function every4xResult(): DiagnosisResult[] {
  const widget = (change?: (f: Files) => void, page = UAT_PAGE) =>
    diagnoseWidgetNotVisible4x(files4x(change), page);
  const flow = (name: string, change?: (f: Files) => void) =>
    diagnoseContentNotVisible4x(files4x(change), "workflow", name);
  return [
    widget(),
    widget((f) => {
      delete f["app-urls.json"];
    }),
    widget((f) => {
      f["app-urls.json"] = [];
    }),
    widget(undefined, "https://other.example.org/x"),
    widget((f) => {
      f["feature-flag.json"] = { urlRegex: true };
      env0(f).urls = ["(unclosed"];
    }),
    widget((f) => {
      for (const entry of f["app-data.json"] as Rec[]) {
        entry.enablePlayer = false;
        entry.widgetConfig = { enabled: false };
      }
    }),
    flow("Create a lead"),
    flow("Create a lead", (f) => {
      delete f["flow.json"];
    }),
    flow("Create a lead", (f) => {
      f["flow.json"] = [];
    }),
    flow("No such flow"),
    flow("Close a deal"),
    flow("Create a lead", (f) => {
      for (const s of f["segments.json"] as Rec[]) s.isActive = false;
    }),
    flow("Book a meeting"),
    flow("Create a lead", (f) => {
      for (const key of Object.keys(f)) {
        if (/^flow-\d+\.json$/.test(key)) f[key] = { steps: [] };
      }
    }),
  ];
}

describe("F3: every 4.x cause cites a 4.x card", () => {
  it("lists the 108 known 4.x cards, none of them the tree root or a routing page", () => {
    expect(KNOWN_4X_CARD_IDS.size).toBe(108);
    for (const id of NOT_A_4X_CARD)
      expect(KNOWN_4X_CARD_IDS.has(id)).toBe(false);
  });

  it("maps each W4X and C4X rule to a known card", () => {
    for (const [ruleId, pageId] of Object.entries(CARD_4X)) {
      expect(KNOWN_4X_CARD_IDS.has(pageId), ruleId).toBe(true);
      expect(NOT_A_4X_CARD.has(pageId), ruleId).toBe(false);
    }
  });

  it("cites a known card on every result, gate and cause the 4.x checks give", () => {
    const results = every4xResult();
    const ruleIds = new Set(
      results.flatMap((r) => r.verdict.causes.map((c) => c.ruleId)),
    );
    expect([...ruleIds].sort()).toEqual([
      "C4X-01",
      "C4X-02",
      "C4X-03",
      "C4X-04",
      "C4X-05",
      "C4X-06",
      "W4X-01",
      "W4X-02",
      "W4X-04",
      "W4X-05",
    ]);
    for (const result of results) {
      const cited = [
        result.cardPageId,
        ...result.gates.map((g) => g.cardPageId),
        ...result.verdict.causes.map((c) => c.cardPageId),
      ];
      for (const pageId of cited) {
        expect(KNOWN_4X_CARD_IDS.has(pageId ?? ""), pageId).toBe(true);
      }
      for (const cause of result.verdict.causes) {
        expect(cause.cardPageId).toBe(
          CARD_4X[cause.ruleId as keyof typeof CARD_4X],
        );
      }
    }
  });

  it("reads layer 3 of a mirror card and layer 1 of a settings card", () => {
    const mirrors = new Set([
      "1509786000",
      "1509786022",
      "1509753805",
      "1509622325",
    ]);
    for (const [ruleId, pageId] of Object.entries(CARD_4X)) {
      expect(cardLayerOf(ruleId as keyof typeof CARD_4X), ruleId).toBe(
        mirrors.has(pageId) ? 3 : 1,
      );
    }
  });
});
