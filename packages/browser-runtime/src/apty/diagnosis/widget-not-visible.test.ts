import { describe, expect, it } from "vitest";
import { capture, evidenceFrom } from "./diagnosis-test-utils";
import type { ClientEvidence } from "./types";
import { patternMatches } from "./url-patterns";
import { diagnoseWidgetNotVisible } from "./widget-not-visible";

type Rec = Record<string, unknown>;

const UAT_PAGE = "https://uat.crm.example.com/leads/42";
const PROD_PAGE = "https://crm.example.com/leads/42";

function files(change?: (f: Record<string, Rec[] | Rec>) => void) {
  const f = capture() as Record<string, Rec[] | Rec>;
  change?.(f);
  return evidenceFrom(f);
}

const envs = (f: Record<string, Rec[] | Rec>) =>
  ((f["app-urls.json"] as Rec[])[0] as Rec).environments as Rec[];
const widgetConfig = (f: Record<string, Rec[] | Rec>) =>
  ((f["app-data.json"] as Rec).config as Rec).widgetConfig as Rec;
const segment = (f: Record<string, Rec[] | Rec>, name: string) =>
  (f["segment.json"] as Rec[]).find((s) => s.name === name) as Rec;

const gateOf = (
  result: ReturnType<typeof diagnoseWidgetNotVisible>,
  reason: string,
) => result.gates.find((g) => g.reason === reason);

describe("patternMatches", () => {
  it("treats a star as anything, matches anywhere in the URL, and nothing else as a wildcard", () => {
    expect(patternMatches("https://crm.example.com/", PROD_PAGE)).toBe(true);
    expect(patternMatches("crm.example.com/leads", PROD_PAGE)).toBe(true);
    expect(patternMatches("https://*.example.com/*", UAT_PAGE)).toBe(true);
    expect(patternMatches("https://crm.example.com/", UAT_PAGE)).toBe(false);
    expect(
      patternMatches("https://crm.example.com/", "https://crmXexample.com/"),
    ).toBe(false);
    expect(
      patternMatches("https://www.example.com/*", "https://example.com/app"),
    ).toBe(false);
  });
});

describe("widget-not-visible", () => {
  it("names the environment the page belongs to and leaves segment membership to the browser", () => {
    const result = diagnoseWidgetNotVisible(files(), UAT_PAGE);

    expect(result.packId).toBe("widget-not-visible");
    expect(gateOf(result, "envMatch")?.detail).toBe(
      "This page belongs to UAT (order 2).",
    );
    expect(gateOf(result, "widgetLimited")?.detail).toBe(
      "The widget is shown only to the segments Sales team, New hires; the user must be in one of them.",
    );
    expect(result.verdict.status).toBe("candidates");
    expect(result.verdict.nextCheck).toBe("testAsMember");
    expect(result.notChecked).toEqual([
      "membership",
      "runtime-rules",
      "widget-css",
    ]);
    expect(result.confidence).toBe("likely");
  });

  it("finds a page no environment covers", () => {
    const result = diagnoseWidgetNotVisible(
      files(),
      "https://other.example.org/x",
    );

    expect(result.verdict.status).toBe("cause_found");
    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "WNV-02",
      cardPageId: "1496645690",
    });
    expect(result.verdict.causes[0]?.evidence).toContain(
      "environments checked: Production (order 1), UAT (order 2)",
    );
  });

  it("finds an environment URL that holds a page-specific path", () => {
    const result = diagnoseWidgetNotVisible(
      files((f) => {
        (envs(f)[0] as Rec).urls = ["https://crm.example.com/leads/"];
      }),
      "https://crm.example.com/accounts/7",
    );

    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "WNV-03",
      cardPageId: "1497104451",
    });
    expect(result.verdict.causes[0]?.evidence).toEqual([
      "Production (order 1): same host, the pattern's path does not match",
    ]);
  });

  it("says which environment wins when a Test pattern also covers the production host", () => {
    const result = diagnoseWidgetNotVisible(
      files((f) => {
        const [prod, uat] = envs(f) as [Rec, Rec];
        prod.order = 2;
        uat.order = 1;
        uat.urls = ["https://*crm.example.com/"];
      }),
      PROD_PAGE,
    );

    expect(gateOf(result, "severalEnvMatch")).toMatchObject({
      status: "unknown",
      ruleId: "WNV-04",
      cardPageId: "1496645709",
      detail:
        "UAT (order 1) wins on this page; Production (order 2) also matches. Users here get UAT's content.",
    });
    expect(result.verdict.nextCheck).toBe("comparePatterns");
  });

  it("notes when the files the Client read are for another environment than this page's", () => {
    const result = diagnoseWidgetNotVisible(files(), PROD_PAGE);

    expect(gateOf(result, "otherEnvLoaded")?.detail).toBe(
      "The files the Apty Client read are for UAT, not Production: they may come from another tab.",
    );
  });

  it("checks no URL pattern without a web page, and says to open one", () => {
    for (const page of [undefined, "chrome://extensions/"]) {
      const result = diagnoseWidgetNotVisible(files(), page);
      expect(gateOf(result, "pageUnknown")?.status).toBe("unknown");
      expect(result.gates.some((g) => g.id === "environment-match")).toBe(
        false,
      );
      expect(result.verdict.nextCheck).toBe("openAppPage");
    }
  });

  it("finds a widget limited to segments that can never be active, with the other-users option off", () => {
    const off = diagnoseWidgetNotVisible(
      files((f) => {
        segment(f, "Sales team").isActive = false;
        segment(f, "New hires").isActive = false;
      }),
      UAT_PAGE,
    );
    expect(off.verdict.causes[0]).toMatchObject({ ruleId: "WNV-07" });
    expect(off.verdict.causes[0]?.summary).toContain(
      "Sales team (turned off), New hires (turned off)",
    );

    const noRule = diagnoseWidgetNotVisible(
      files((f) => {
        segment(f, "Sales team").ruleId =
          "01000000-0000-7000-8000-00000000dead";
        segment(f, "New hires").isActive = false;
      }),
      UAT_PAGE,
    );
    expect(noRule.verdict.causes[0]?.summary).toContain(
      "Sales team (rule missing)",
    );
  });

  it("leaves a selected segment missing from segment.json open, since its effect is not verified", () => {
    const result = diagnoseWidgetNotVisible(
      files((f) => {
        f["segment.json"] = (f["segment.json"] as Rec[]).filter(
          (s) => s.name !== "Sales team" && s.name !== "New hires",
        );
      }),
      UAT_PAGE,
    );

    expect(gateOf(result, "widgetSegmentsMissing")?.status).toBe("unknown");
    expect(result.verdict.causes).toEqual([]);
  });

  it("finds no audience blocker when the widget is for everyone or for other users too", () => {
    const forAll = diagnoseWidgetNotVisible(
      files((f) => {
        widgetConfig(f).display = "All";
      }),
      UAT_PAGE,
    );
    expect(gateOf(forAll, "widgetForAll")?.status).toBe("pass");

    const otherUsers = diagnoseWidgetNotVisible(
      files((f) => {
        widgetConfig(f).enabledForOtherUser = true;
      }),
      UAT_PAGE,
    );
    expect(gateOf(otherUsers, "widgetOtherUsers")?.status).toBe("pass");
    expect(otherUsers.verdict).toMatchObject({
      status: "no_cause_in_data",
      nextCheck: "sendSupport",
    });
  });

  it("lists an environment's own visibility rule and the restriction patterns as open", () => {
    const result = diagnoseWidgetNotVisible(
      files((f) => {
        const uat = envs(f)[1] as Rec;
        uat.visibilityRuleId = (f["rule.json"] as Rec[])[0]?.id;
        uat.visibilityRuleAction = "HIDE";
        widgetConfig(f).restrictionPatterns = ["/admin/*", "/print/*"];
      }),
      UAT_PAGE,
    );

    expect(gateOf(result, "envVisibilityRule")?.detail).toBe(
      'UAT has its own visibility rule "Sales users" (HIDE), evaluated in the browser.',
    );
    expect(gateOf(result, "restrictionPatterns")?.params).toEqual({ count: 2 });
  });

  it("finds an empty app-urls.json, which loads nothing anywhere", () => {
    const result = diagnoseWidgetNotVisible(
      files((f) => {
        f["app-urls.json"] = [];
      }),
      UAT_PAGE,
    );

    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "WNV-01",
      cardPageId: "1496253321",
    });
    expect(result.verdict.nextCheck).toBe("readStatus");
  });

  it("names missing data, an unreachable Client and a 4.x tenant instead of concluding", () => {
    const missing = diagnoseWidgetNotVisible(
      files((f) => {
        delete f["app-urls.json"];
      }),
      UAT_PAGE,
    );
    expect(missing.verdict).toMatchObject({
      status: "no_data",
      nextCheck: "reload",
    });

    const unreachable: ClientEvidence = {
      connection: {
        ok: false,
        failure: "no_receiver",
        message: "Nothing listening.",
      },
      observedNames: [],
      files: {},
    };
    expect(diagnoseWidgetNotVisible(unreachable, UAT_PAGE).verdict.status).toBe(
      "no_data",
    );

    const fourX = diagnoseWidgetNotVisible(
      evidenceFrom(capture("content-4x")),
      UAT_PAGE,
    );
    expect(fourX.verdict.status).toBe("out_of_scope");
  });
});
