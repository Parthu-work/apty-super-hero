import { describe, expect, it } from "vitest";
import {
  REDACTED_TITLE,
  redactAuditUrl,
  redactDomHealthOutput,
} from "./dom-health-redaction";

describe("redactAuditUrl", () => {
  it("removes the tenant and session from an Infor OS Portal application frame src", () => {
    const url =
      "https://eln.example.test/webui/servlet/fslogin?LogicalId=lid://infor.ln.ln01&inforTenantId=FAKETENANT00000_TRN&inforSessionId=FAKETENANT00000_TRN~00000000-0000-4000-8000-000000000000&inforThemeName=Light";

    const redacted = redactAuditUrl(url);

    expect(redacted).not.toContain("FAKETENANT00000_TRN");
    expect(redacted).not.toContain("00000000-0000-4000-8000-000000000000");
    expect(new URL(redacted).searchParams.get("LogicalId")).toBe(
      "lid://infor.ln.ln01",
    );
    expect(new URL(redacted).searchParams.get("inforThemeName")).toBe("Light");
  });

  it("masks an athenaOne practice id in the path but keeps the short department segment", () => {
    expect(
      redactAuditUrl("https://ehr.example.test/4242424/2/globalframeset.esp"),
    ).toBe("https://ehr.example.test/:id/2/globalframeset.esp");
  });

  it("redacts a token carried in the fragment", () => {
    const redacted = redactAuditUrl(
      "https://app.example.test/#/callback?access_token=fake-token-value",
    );
    expect(redacted).not.toContain("fake-token-value");
    expect(redacted).toContain("#/callback");
  });
});

describe("redactDomHealthOutput", () => {
  it("replaces the page title and scrubs identifier-shaped DOM text", () => {
    const out = redactDomHealthOutput({
      pageTitle: "Example Practice [4242424]",
      elementSamples: [{ bestSelector: '[data-mrn="7654321"]' }],
    });

    expect(out.pageTitle).toBe(REDACTED_TITLE);
    expect(out.elementSamples[0]?.bestSelector).toBe('[data-mrn=":id"]');
  });

  it("redacts the value of a sensitive-named data attribute and element-path attribute", () => {
    const out = redactDomHealthOutput({
      dataAttributes: { "osp-id": "LN", "csrf-token": "abc" },
      path: [
        { tag: "div", attributes: [{ name: "data-session", value: "s1" }] },
      ],
    });

    expect(out.dataAttributes).toEqual({
      "osp-id": "LN",
      "csrf-token": "<REDACTED>",
    });
    expect(out.path[0]?.attributes[0]?.value).toBe("<REDACTED>");
  });

  it("leaves scores, counts and the engine's own identifiers exactly as computed", () => {
    const input = {
      auditId: "dom-health-1791480287000-1",
      score: 73,
      counts: { totalElements: 3788 },
      stateGraph: { seedStateId: "state-1791480287000" },
      risks: [{ id: "low-stability", title: "Low selector stability" }],
    };

    expect(redactDomHealthOutput(input)).toEqual(input);
  });

  it("treats a list of URLs as URLs", () => {
    const out = redactDomHealthOutput({
      sampleUrls: ["https://ehr.example.test/4242424/2/a.esp?tenant=X"],
    });
    expect(out.sampleUrls[0]).toBe(
      "https://ehr.example.test/:id/2/a.esp?tenant=%3CREDACTED%3E",
    );
  });
});
