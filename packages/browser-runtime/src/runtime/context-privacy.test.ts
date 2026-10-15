import type { Context } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import { privateContexts } from "./context-privacy";

const URL_PHI = "https://ehr.example.com/chart?mrn=884213&dob=1961-04-02";
const TITLE = "Jane Testpatient - Chart";

function tab(): Context {
  return {
    id: "tab-7",
    type: "tab",
    providerId: "browser.tabs",
    label: TITLE,
    value: URL_PHI,
    metadata: { tabId: 7, url: URL_PHI, title: TITLE },
  };
}

function page(): Context {
  return {
    id: "page-7",
    type: "page",
    providerId: "browser.current-page",
    label: TITLE,
    value: `URL: ${URL_PHI}\nTitle: ${TITLE}`,
    metadata: { tabId: 7, url: URL_PHI, title: TITLE },
  };
}

describe("privateContexts", () => {
  it("withholds the title and keeps only the origin in Strict", () => {
    const [t, p] = privateContexts([tab(), page()], "withhold");
    const sent = JSON.stringify([t?.label, t?.value, p?.label, p?.value]);
    expect(sent).not.toMatch(/Testpatient|884213|1961/);
    expect(t?.label).toBe("https://ehr.example.com");
    expect(t?.value).toBe("https://ehr.example.com/chart");
  });

  it("masks query values and keeps the title in Standard", () => {
    const [t] = privateContexts([tab()], "mask");
    expect(t?.label).toBe(TITLE);
    expect(t?.value).toBe(
      "https://ehr.example.com/chart?mrn=[masked]&dob=[masked]",
    );
  });

  it("changes nothing in Off", () => {
    const contexts = [tab(), page()];
    expect(privateContexts(contexts, "show")).toBe(contexts);
  });

  it("leaves a file context alone", () => {
    const file: Context = {
      id: "f",
      type: "file",
      providerId: "ui",
      label: "notes.txt",
      value: new Blob(["x"]),
    };
    expect(privateContexts([file], "withhold")[0]).toBe(file);
  });
});
