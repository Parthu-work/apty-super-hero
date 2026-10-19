import { applyUrlPolicy } from "@apty/dom-snapshot";
import { afterEach, describe, expect, it, vi } from "vitest";

const mode = vi.hoisted(() => ({ value: "withhold" as string }));
vi.mock("../runtime/value-policy", () => ({
  currentValuePolicy: () => mode.value,
}));

import { shownEvidence, shownResourceName, shownUrl } from "./shown-url";

afterEach(() => {
  mode.value = "withhold";
});

describe("shownUrl", () => {
  it("masks a relative URL like an absolute one, returning only path and query", () => {
    expect(shownUrl("/api/users/4815162342.json?dob=1980-01-01")).toBe(
      "/api/users/:id.json",
    );
    mode.value = "mask";
    expect(shownUrl("/api/users/4815162342.json?dob=1980-01-01")).toBe(
      "/api/users/4815162342.json?dob=[masked]",
    );
    mode.value = "show";
    expect(shownUrl("users/1.json?x=1#top")).toBe("/users/1.json?x=1#top");
  });

  it("returns nothing, never the raw text, for a URL it can't parse", () => {
    const broken = "http://[4815162342";
    expect(applyUrlPolicy(broken, "withhold")).toBe("");
    expect(shownUrl(broken)).toBe("");
    expect(shownResourceName(broken)).toBe("");
  });
});

describe("shownEvidence", () => {
  it("masks the record's URL and its data's resource name, keeping everything else", () => {
    const record = {
      evidenceId: "e",
      source: "service-worker" as const,
      type: "network-response",
      timestamp: 1,
      scope: "shared" as const,
      url: "/api/users/4815162342.json?dob=1980-01-01",
      data: { resourceName: "4815162342.json", status: 200 },
    };
    expect(shownEvidence(record)).toEqual({
      ...record,
      url: "/api/users/:id.json",
      data: { resourceName: ":id.json", status: 200 },
    });
    expect(record.url).toContain("4815162342");
  });
});
