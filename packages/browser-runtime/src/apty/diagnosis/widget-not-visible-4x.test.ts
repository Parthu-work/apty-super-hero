import { describe, expect, it } from "vitest";
import { capture, evidenceFrom } from "./diagnosis-test-utils";
import type { Rec } from "./pack-kit";
import type { ClientEvidence, LoadedFile } from "./types";
import { diagnoseWidgetNotVisible } from "./widget-not-visible";
import { diagnoseWidgetNotVisible4x } from "./widget-not-visible-4x";

const UAT_PAGE = "https://uat.crm.example.com/leads/42";
const PROD_PAGE = "https://crm.example.com/leads/42";

function files4x(change?: (f: Record<string, unknown>) => void) {
  const files = capture("content-4x");
  change?.(files);
  return evidenceFrom(files);
}
const apps = (f: Record<string, unknown>) => f["app-urls.json"] as Rec[];
const envOf = (f: Record<string, unknown>, app: number, env: string) =>
  (apps(f)[app]?.environments as Rec)[env] as Rec;
const appData = (f: Record<string, unknown>) => f["app-data.json"] as Rec;
const dataEnv = (f: Record<string, unknown>, env: string) =>
  (appData(f).environments as Rec)[env] as Rec;
const regexOn = (f: Record<string, unknown>) => {
  f["feature-flag.json"] = {
    regExpUrl: { key: "RegExpURL", status: true },
    publishingSystem: { key: "PublishingSystem", status: true },
  };
};
const withFile = (evidence: ClientEvidence, file: LoadedFile) => ({
  ...evidence,
  files: { ...evidence.files, [file.name]: file },
});
const causes = (result: ReturnType<typeof diagnoseWidgetNotVisible4x>) =>
  result.verdict.causes.map((c) => c.ruleId);
const matchedEnv = (result: ReturnType<typeof diagnoseWidgetNotVisible4x>) =>
  result.gates.find((g) => g.reason === "envMatch")?.params.env;

describe("widget-not-visible for a 4.x tenant (K14, checked against apty-assist in K21 F4)", () => {
  it("F4: names the pinned apty-assist commit and player version, and is as certain as the 5.x rules", () => {
    const result = diagnoseWidgetNotVisible4x(files4x(), UAT_PAGE);
    expect(result.aptyVersion).toBe("4.x");
    expect(result.verifiedOn).toBe(
      "4.x code, apty-assist bbb4cbc (player 4.30.0); from code, not runtime-verified",
    );
    expect(result.confidence).toBe("likely");
    expect(result.cardPageId).toBe("1509785878");
    expect(result.files.map((f) => f.name)).toEqual([
      "app-urls.json",
      "app-data.json",
      "feature-flag.json",
      "segments.json",
    ]);
    expect(causes(result)).toEqual([]);
    expect(result.verdict.status).toBe("no_cause_in_data");
  });

  it("W4X-00: app-urls.json was not seen, which the snippet's own list can explain", () => {
    const evidence = files4x((f) => {
      delete f["app-urls.json"];
    });
    const result = diagnoseWidgetNotVisible4x(evidence, UAT_PAGE);
    expect(result.verdict).toMatchObject({
      status: "no_data",
      nextCheck: "reload",
    });
    expect(result.gates.map((g) => g.reason)).toEqual([
      "notObserved",
      "appUrlsFromSnippet4x",
    ]);
  });

  it("W4X-01: app-urls.json failed, so the 4.x player finds no application", () => {
    const evidence = withFile(files4x(), {
      name: "app-urls.json",
      status: "http_error",
      httpStatus: 503,
    });
    const result = diagnoseWidgetNotVisible4x(evidence, UAT_PAGE);
    expect(causes(result)).toEqual(["W4X-01"]);
    expect(result.gates[0]).toMatchObject({
      reason: "appUrlsFailed4x",
      params: { variant: "failed", httpStatus: 503 },
    });
  });

  it("W4X-01: app-urls.json is an empty list: no application is published", () => {
    const result = diagnoseWidgetNotVisible4x(
      files4x((f) => {
        f["app-urls.json"] = [];
      }),
      UAT_PAGE,
    );
    expect(causes(result)).toEqual(["W4X-01"]);
    expect(result.gates[0]?.reason).toBe("appUrlsEmpty");
  });

  it("W4X-02: no environment's pattern matches the page", () => {
    const result = diagnoseWidgetNotVisible4x(
      files4x(),
      "https://other.example.org/x",
    );
    expect(causes(result)).toEqual(["W4X-02"]);
    expect(result.verdict.causes[0]?.params.envs).toBe(
      "FIXTURE CRM: Production, UAT; FIXTURE HR: Production",
    );
  });

  it("F4: environments are an object keyed by id, each with one url, tried in text order", () => {
    expect(matchedEnv(diagnoseWidgetNotVisible4x(files4x(), UAT_PAGE))).toBe(
      "FIXTURE CRM: UAT",
    );
    const keyed = files4x((f) => {
      const environments = apps(f)[0]?.environments as Rec;
      environments["10"] = { name: "Ten", url: "crm.example.com" };
      environments["2"] = { name: "Two", url: "crm.example.com" };
      environments["1"] = { name: "One", url: "nothing.example" };
    });
    expect(
      matchedEnv(
        diagnoseWidgetNotVisible4x(keyed, "https://crm.example.com/a"),
      ),
    ).toBe("FIXTURE CRM: Ten");
    const oldShape = files4x((f) => {
      (apps(f)[0] as Rec).environments = [
        { id: 3012, name: "UAT", urls: ["uat.crm.example.com"] },
      ];
    });
    expect(
      matchedEnv(diagnoseWidgetNotVisible4x(oldShape, UAT_PAGE)),
    ).toBeUndefined();
  });

  it("takes the first application in array order, matches anywhere in the address, and escapes every character but *", () => {
    const both = (first: number) =>
      files4x((f) => {
        envOf(f, 1, "1").url = "crm.example.com";
        if (first === 1) apps(f).reverse();
      });
    const page = "https://crm.example.com/accounts";
    expect(matchedEnv(diagnoseWidgetNotVisible4x(both(0), page))).toBe(
      "FIXTURE CRM: Production",
    );
    expect(matchedEnv(diagnoseWidgetNotVisible4x(both(1), page))).toBe(
      "FIXTURE HR: Production",
    );
    const dotted = files4x((f) => {
      envOf(f, 0, "2").url = "uat.crm.example.com";
    });
    expect(
      causes(
        diagnoseWidgetNotVisible4x(dotted, "https://uatxcrm.example.com/"),
      ),
    ).toEqual(["W4X-02"]);
  });

  it("F4: the regex flag is feature-flag.json's regExpUrl status; a regex is tried first, then the * pattern", () => {
    const regexPattern = "https://(uat|qa)\\.crm\\.example\\.com/";
    const qa = "https://qa.crm.example.com/leads";
    const off = files4x((f) => {
      envOf(f, 0, "2").url = regexPattern;
    });
    expect(causes(diagnoseWidgetNotVisible4x(off, qa))).toEqual(["W4X-02"]);
    const oldFlag = files4x((f) => {
      envOf(f, 0, "2").url = regexPattern;
      f["feature-flag.json"] = [{ key: "urlRegex", enabled: true }];
    });
    expect(causes(diagnoseWidgetNotVisible4x(oldFlag, qa))).toEqual(["W4X-02"]);
    const on = files4x((f) => {
      envOf(f, 0, "2").url = regexPattern;
      regexOn(f);
    });
    expect(causes(diagnoseWidgetNotVisible4x(on, qa))).toEqual([]);
  });

  it("W4X-03 (F4): an invalid regex stops the whole search, so nothing loads", () => {
    const invalid = files4x((f) => {
      envOf(f, 0, "1").url = "*.crm.example.com/*";
      regexOn(f);
    });
    const result = diagnoseWidgetNotVisible4x(invalid, UAT_PAGE);
    expect(causes(result)).toEqual(["W4X-03"]);
    expect(result.verdict.causes[0]?.params).toMatchObject({
      env: "FIXTURE CRM: Production",
      pattern: "*.crm.example.com/*",
    });
    expect(matchedEnv(result)).toBeUndefined();
    const reachedAfterMatch = files4x((f) => {
      envOf(f, 1, "1").url = "*.hr.example.com/*";
      regexOn(f);
    });
    expect(
      causes(diagnoseWidgetNotVisible4x(reachedAfterMatch, UAT_PAGE)),
    ).toEqual([]);
  });

  it("W4X-04 (F4): enablePlayer must be truthy for the page's environment in app-data.json, else production's", () => {
    for (const value of [false, undefined, 0]) {
      const result = diagnoseWidgetNotVisible4x(
        files4x((f) => {
          dataEnv(f, "2").enablePlayer = value;
        }),
        UAT_PAGE,
      );
      expect(causes(result), String(value)).toEqual(["W4X-04"]);
      expect(result.verdict.causes[0]?.params.env).toBe("FIXTURE CRM: UAT");
    }
    const fallback = (production: boolean) =>
      diagnoseWidgetNotVisible4x(
        files4x((f) => {
          delete (appData(f).environments as Rec)["2"];
          dataEnv(f, "1").enablePlayer = production;
        }),
        UAT_PAGE,
      );
    expect(causes(fallback(true))).toEqual([]);
    expect(causes(fallback(false))).toEqual(["W4X-04"]);
    expect(fallback(false).verdict.causes[0]?.params.env).toBe(
      "FIXTURE CRM: Production",
    );
  });

  it("W4X-05 (F4): widgetConfig shows the widget to all, to selected segments, or to nobody", () => {
    const shown = diagnoseWidgetNotVisible4x(files4x(), PROD_PAGE);
    expect(shown.gates.map((g) => g.reason)).toContain("widgetForAll4x");
    const specific = (config: Rec) =>
      diagnoseWidgetNotVisible4x(
        files4x((f) => {
          dataEnv(f, "1").widgetConfig = config;
        }),
        PROD_PAGE,
      );
    const sales = specific({
      display: "Specific",
      selectedSegments: [4219],
      enabledForOtherUser: false,
    });
    expect(causes(sales)).toEqual([]);
    expect(sales.gates.find((g) => g.ruleId === "W4X-05")).toMatchObject({
      status: "unknown",
      reason: "widgetSegments4x",
      params: { segments: "Sales team" },
    });
    const nobody = specific({
      display: "Specific",
      selectedSegments: [],
      enabledForOtherUser: false,
    });
    expect(causes(nobody)).toEqual(["W4X-05"]);
    expect(nobody.verdict.causes[0]?.params.variant).toBe("nobody");
    const other = specific({ display: "None" });
    expect(causes(other)).toEqual(["W4X-05"]);
    expect(other.verdict.causes[0]?.params.variant).toBe("display");
    expect(causes(specific({ enabled: false }))).toEqual(["W4X-05"]);
  });

  it("W4X-06 (F4): app-data.json without config.customConfig stops the player as it starts", () => {
    const result = diagnoseWidgetNotVisible4x(
      files4x((f) => {
        delete appData(f).config;
      }),
      UAT_PAGE,
    );
    expect(causes(result)).toEqual(["W4X-06"]);
    expect(result.verdict.causes[0]?.cardPageId).toBe("1509785878");
  });

  it("says when the app-data.json read is for another application", () => {
    const result = diagnoseWidgetNotVisible4x(
      files4x((f) => {
        appData(f).id = 302;
      }),
      UAT_PAGE,
    );
    expect(
      result.gates.find((g) => g.reason === "appDataOtherApp4x"),
    ).toMatchObject({
      status: "unknown",
      params: { app: "302" },
    });
  });

  it("needs an open page to match the patterns", () => {
    const result = diagnoseWidgetNotVisible4x(files4x(), undefined);
    expect(result.gates.find((g) => g.id === "page")?.reason).toBe(
      "pageUnknown",
    );
    expect(result.verdict.nextCheck).toBe("openAppPage");
  });
});

describe("routing by player version", () => {
  it("runs the 4.x pack for 4.x files, the 5.x pack for 5.x and unknown ones", () => {
    expect(diagnoseWidgetNotVisible(files4x(), UAT_PAGE).aptyVersion).toBe(
      "4.x",
    );
    expect(
      diagnoseWidgetNotVisible(evidenceFrom(capture()), UAT_PAGE).aptyVersion,
    ).toBeUndefined();
    const unknown: ClientEvidence = {
      ...evidenceFrom(capture()),
      observedNames: ["app-urls.json", "app-data.json"],
    };
    const result = diagnoseWidgetNotVisible(unknown, UAT_PAGE);
    expect(result.aptyVersion).toBeUndefined();
    expect(result.verdict.status).not.toBe("out_of_scope");
  });
});
