import { describe, expect, it } from "vitest";
import { matchEnvironments } from "./url-patterns";

const PAGE = "https://uat.crm.example.com/leads/42";

const outcome = (urls: string[]) =>
  matchEnvironments(
    [{ environments: [{ name: "UAT", order: 1, urls }] }],
    PAGE,
  ).map(({ matches, regex }) => ({ matches, regex }))[0];

describe("matchEnvironments with the regex URL flags on", () => {
  it("falls back to the wildcard when a pattern does not match as a regex", () => {
    expect(outcome(["https://*.crm.example.com/*"])).toEqual({
      matches: true,
      regex: "match",
    });
  });

  it("matches a pattern as a raw regex that no wildcard reading matches", () => {
    expect(outcome(["https://(uat|qa)\\.crm\\.example\\.com/"])).toEqual({
      matches: false,
      regex: "match",
    });
  });

  it("is case-sensitive and unanchored, as the player's RegExp is", () => {
    expect(outcome(["CRM\\.example"])).toEqual({
      matches: false,
      regex: "none",
    });
    expect(outcome(["crm\\.example\\.com/leads"])).toEqual({
      matches: false,
      regex: "match",
    });
  });

  it("stops at a pattern that is not a valid regex, even one the wildcard reading matches", () => {
    expect(outcome(["*.crm.example.com/*"])).toEqual({
      matches: true,
      regex: "invalid",
    });
    expect(outcome(["https://(uat", "https://uat.crm.example.com/"])).toEqual({
      matches: true,
      regex: "invalid",
    });
  });

  it("never reaches an invalid pattern after one that already matched as a regex", () => {
    expect(
      outcome(["https://uat.crm.example.com/", "*.crm.example.com"]),
    ).toEqual({ matches: true, regex: "match" });
  });
});
