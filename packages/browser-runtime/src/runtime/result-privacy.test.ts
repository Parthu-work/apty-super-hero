import { describe, expect, it } from "vitest";
import { applyResultPrivacy } from "./result-privacy";

const PHI_URL =
  "https://ehr.example.com/patients/chart?mrn=884213&dob=1961-04-02#notes";

describe("applyResultPrivacy", () => {
  it("leaves everything as is when values are shown (Off)", () => {
    const result = { id: 1, url: PHI_URL, title: "Jane Testpatient - Chart" };
    expect(applyResultPrivacy(result, "show")).toBe(result);
  });

  it("masks query values in Standard and keeps the title", () => {
    expect(
      applyResultPrivacy(
        { id: 1, url: PHI_URL, title: "Jane Testpatient - Chart" },
        "mask",
      ),
    ).toEqual({
      id: 1,
      url: "https://ehr.example.com/patients/chart?mrn=[masked]&dob=[masked]",
      title: "Jane Testpatient - Chart",
    });
  });

  it("reduces a tab or page to its id and origin in Strict", () => {
    expect(
      applyResultPrivacy(
        {
          tabs: [
            { id: 7, url: PHI_URL, title: "Jane Testpatient", active: true },
          ],
        },
        "withhold",
      ),
    ).toEqual({
      tabs: [{ id: 7, url: "https://ehr.example.com", active: true }],
    });
  });

  it("drops the query of a URL that is not a page descriptor in Strict", () => {
    expect(
      applyResultPrivacy(
        { request: { url: PHI_URL, status: 200 } },
        "withhold",
      ),
    ).toEqual({
      request: { url: "https://ehr.example.com/patients/chart", status: 200 },
    });
  });

  it("applies the policy to URLs inside text", () => {
    expect(
      applyResultPrivacy(
        { message: `GET ${PHI_URL} failed; see https://docs.example.com/x` },
        "withhold",
      ),
    ).toEqual({
      message:
        "GET https://ehr.example.com/patients/chart failed; see https://docs.example.com/x",
    });
  });

  it("handles a result that is JSON text", () => {
    const text = JSON.stringify({ id: 2, url: PHI_URL, title: "Jane" });
    expect(JSON.parse(applyResultPrivacy(text, "withhold") as string)).toEqual({
      id: 2,
      url: "https://ehr.example.com",
    });
  });

  it("never rewrites data: or blob: values", () => {
    const image = "data:image/png;base64,AAAA?x=1";
    const result = {
      imageData: image,
      src: "blob:https://a.test/1",
      url: image,
    };
    expect(applyResultPrivacy(result, "withhold")).toEqual(result);
  });

  it("keeps non-page titles", () => {
    const result = { findings: [{ title: "Missing label", severity: "high" }] };
    expect(applyResultPrivacy(result, "withhold")).toEqual(result);
  });

  it("returns the same object when nothing changes", () => {
    const result = { ok: true, items: [1, 2, { name: "x" }] };
    expect(applyResultPrivacy(result, "withhold")).toBe(result);
  });
});
