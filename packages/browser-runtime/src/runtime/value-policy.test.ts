import { describe, expect, it } from "vitest";
import { valuePolicyForMode } from "./value-policy.js";

describe("value policy by redaction mode", () => {
  it("withholds in Strict, masks in Standard, shows in Off", () => {
    expect(valuePolicyForMode("strict")).toBe("withhold");
    expect(valuePolicyForMode("standard")).toBe("mask");
    expect(valuePolicyForMode("off")).toBe("show");
  });
});
