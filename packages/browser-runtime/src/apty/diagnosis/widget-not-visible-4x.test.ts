import { describe, expect, it } from "vitest";
import { capture, evidenceFrom } from "./diagnosis-test-utils";
import type { Rec } from "./pack-kit";
import type { ClientEvidence, LoadedFile } from "./types";
import { diagnoseWidgetNotVisible } from "./widget-not-visible";
import { diagnoseWidgetNotVisible4x } from "./widget-not-visible-4x";

const UAT_PAGE = "https://uat.crm.example.com/leads/42";

function files4x(change?: (f: Record<string, unknown>) => void) {
  const files = capture("content-4x");
  change?.(files);
  return evidenceFrom(files);
}
const apps = (f: Record<string, unknown>) => f["app-urls.json"] as Rec[];
const envOf = (f: Record<string, unknown>, app: number, env: number) =>
  (apps(f)[app]?.environments as Rec[])[env] as Rec;
const appData = (f: Record<string, unknown>) => f["app-data.json"] as Rec[];
const withFile = (evidence: ClientEvidence, file: LoadedFile) => ({
  ...evidence,
  files: { ...evidence.files, [file.name]: file },
});
const causes = (result: ReturnType<typeof diagnoseWidgetNotVisible4x>) =>
  result.verdict.causes.map((c) => c.ruleId);

describe("widget-not-visible for a 4.x tenant (K14)", () => {
  it("says every finding comes from 4.x code and is not runtime-verified, and cites a 4.x card", () => {
    const result = diagnoseWidgetNotVisible4x(files4x(), UAT_PAGE);
    expect(result.aptyVersion).toBe("4.x");
    expect(result.verifiedOn).toMatch(
      /^4\.x code, apty-assist .*not runtime-verified/,
    );
    expect(result.cardPageId).toBe("1509786000");
    expect(result.files.map((f) => f.name)).toEqual([
      "app-urls.json",
      "app-data.json",
      "feature-flag.json",
    ]);
  });

  it("W4X-00: app-urls.json was not seen", () => {
    const evidence = files4x((f) => {
      delete f["app-urls.json"];
    });
    const result = diagnoseWidgetNotVisible4x(evidence, UAT_PAGE);
    expect(result.verdict).toMatchObject({
      status: "no_data",
      nextCheck: "reload",
    });
    expect(result.gates[0]?.reason).toBe("notObserved");
  });

  it("W4X-01: app-urls.json failed, which the 4.x player reads as an empty list", () => {
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

  it("matches a pattern anywhere in the address, and takes the first application in file order", () => {
    const uat = diagnoseWidgetNotVisible4x(files4x(), UAT_PAGE);
    expect(causes(uat)).toEqual([]);
    expect(
      uat.gates.find((g) => g.reason === "envMatch")?.params,
    ).toMatchObject({
      env: "FIXTURE CRM: UAT",
    });

    const both = (first: number) =>
      files4x((f) => {
        envOf(f, 1, 0).urls = ["crm.example.com"];
        if (first === 1) apps(f).reverse();
      });
    const page = "https://crm.example.com/accounts";
    expect(
      diagnoseWidgetNotVisible4x(both(0), page).gates.find(
        (g) => g.reason === "envMatch",
      )?.params.env,
    ).toBe("FIXTURE CRM: Production");
    expect(
      diagnoseWidgetNotVisible4x(both(1), page).gates.find(
        (g) => g.reason === "envMatch",
      )?.params.env,
    ).toBe("FIXTURE HR: Production");
  });

  it("tries patterns as regular expressions only with the tenant's regex URL flag on, and reports an invalid one", () => {
    const regexPattern = "https://(uat|qa)\\.crm\\.example\\.com/";
    const qa = "https://qa.crm.example.com/leads";
    const off = files4x((f) => {
      envOf(f, 0, 1).urls = [regexPattern];
    });
    expect(causes(diagnoseWidgetNotVisible4x(off, qa))).toEqual(["W4X-02"]);
    const on = files4x((f) => {
      envOf(f, 0, 1).urls = [regexPattern];
      f["feature-flag.json"] = [{ key: "urlRegex", enabled: true }];
    });
    expect(causes(diagnoseWidgetNotVisible4x(on, qa))).toEqual([]);

    const invalid = files4x((f) => {
      envOf(f, 0, 0).urls = ["*.crm.example.com/*"];
      f["feature-flag.json"] = [{ key: "urlRegex", enabled: true }];
    });
    const result = diagnoseWidgetNotVisible4x(invalid, UAT_PAGE);
    expect(result.gates.find((g) => g.ruleId === "W4X-03")).toMatchObject({
      status: "unknown",
      reason: "envRegexInvalid4x",
      params: {
        env: "FIXTURE CRM: Production",
        pattern: "*.crm.example.com/*",
      },
    });
    expect(result.gates.find((g) => g.reason === "envMatch")?.params.env).toBe(
      "FIXTURE CRM: Production",
    );
  });

  it("W4X-04: the player is switched off for the page's environment", () => {
    const result = diagnoseWidgetNotVisible4x(
      files4x((f) => {
        (appData(f)[1] as Rec).enablePlayer = false;
      }),
      UAT_PAGE,
    );
    expect(causes(result)).toEqual(["W4X-04"]);
    expect(result.verdict.causes[0]?.params.env).toBe("FIXTURE CRM: UAT");
  });

  it("W4X-05: the widget is switched off for the page's environment", () => {
    const result = diagnoseWidgetNotVisible4x(
      files4x((f) => {
        (appData(f)[1] as Rec).widgetConfig = { enabled: false };
      }),
      UAT_PAGE,
    );
    expect(causes(result)).toEqual(["W4X-05"]);
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
