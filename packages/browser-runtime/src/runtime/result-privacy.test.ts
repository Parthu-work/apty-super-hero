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

  it("drops the title of a tab told by its origin in Strict, as devtools results give it (M2)", () => {
    expect(
      applyResultPrivacy(
        {
          meta: {
            tab: {
              id: 7,
              origin: "https://ehr.example.com/",
              title: "Jane Testpatient",
            },
          },
        },
        "withhold",
      ),
    ).toEqual({ meta: { tab: { id: 7, origin: "https://ehr.example.com/" } } });
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

  it("masks any string under a URL key, relative or not, and empties one it can't parse", () => {
    const result = {
      ogImage: "/patients/884213/photo.jpg?mrn=884213",
      favicon: "https://[patients/884213?mrn=884213",
      url: "file:///patients/884213/chart?mrn=884213",
    };
    expect(applyResultPrivacy(result, "withhold")).toEqual({
      ogImage: "/patients/:id/photo.jpg",
      favicon: "",
      url: "file:///patients/:id/chart",
    });
  });

  it("masks a whole value shaped like a URL under any key, but not prose, XPath or JSON text", () => {
    const xpath = "//button[normalize-space()='Save']";
    const json = '{"next":"https://ehr.example/patients/884213"}';
    const result = {
      segmentsUrl: "/patients/884213/chart?mrn=884213",
      cdn: "//cdn.example.com/patients/884213/x.js",
      selector: xpath,
      absolutePath: "/html/body/div[3]",
      note: "opened /patients/884213/chart today",
      body: json,
    };
    expect(applyResultPrivacy(result, "withhold")).toEqual({
      segmentsUrl: "/patients/:id/chart",
      cdn: "//cdn.example.com/patients/:id/x.js",
      selector: xpath,
      absolutePath: "/html/body/div[3]",
      note: "opened /patients/884213/chart today",
      body: '{"next":"https://ehr.example/patients/:id"}',
    });
  });

  it("drops a local file's title in Strict but keeps a browser page's", () => {
    expect(
      applyResultPrivacy(
        {
          id: 1,
          title: "Smith, John — chart",
          url: "file:///patients/884213.html",
        },
        "withhold",
      ),
    ).toEqual({ id: 1, url: "file://" });
    expect(
      applyResultPrivacy(
        { id: 2, title: "Extensions", url: "chrome://extensions" },
        "withhold",
      ),
    ).toEqual({ id: 2, title: "Extensions", url: "chrome://extensions" });
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
