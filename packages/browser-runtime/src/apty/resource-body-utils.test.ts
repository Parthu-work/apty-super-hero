import { describe, expect, it } from "vitest";
import { isUrlDenied, matchingDenyEntry } from "./resource-body-utils";

describe("isUrlDenied", () => {
  it.each([
    ["https://bank.example/x", ["bank.example"], true],
    ["https://api.bank.example/x", ["Bank.Example"], true],
    ["https://notbank.example/x", ["bank.example"], false],
    ["https://app.test/api/patients/7", ["/api/patients"], true],
    ["https://app.test/api/segments", ["/api/patients", " "], false],
    ["not a url /api/patients", ["/api/patients"], true],
  ])("%s with %j -> %s", (url, denyList, expected) => {
    expect(isUrlDenied(url, denyList)).toBe(expected);
  });
});

describe("matchingDenyEntry", () => {
  it("returns the first matching entry as written, trimmed", () => {
    expect(
      matchingDenyEntry("https://api.bank.example/users/7", [
        "  /orders ",
        " Bank.Example ",
        "/users/",
      ]),
    ).toBe("Bank.Example");
  });

  it("returns null when nothing matches", () => {
    expect(matchingDenyEntry("https://app.test/x", ["/users/", ""])).toBeNull();
  });
});
