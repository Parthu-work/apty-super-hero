import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetKbVersions,
  kbVersionForHost,
  rememberKbVersion,
} from "./kb-version.js";

beforeEach(() => forgetKbVersions());

describe("the tab's Apty version", () => {
  it("is unknown until a check's files or the user say", () => {
    expect(kbVersionForHost("crm.example.com")).toBe("unknown");
    expect(kbVersionForHost(undefined)).toBe("unknown");
  });

  it("takes the user's choice per site host", () => {
    rememberKbVersion("crm.example.com", "4.x", "user");
    expect(kbVersionForHost("crm.example.com")).toBe("4.x");
    expect(kbVersionForHost("hr.example.com")).toBe("unknown");
    rememberKbVersion("crm.example.com", "unknown", "user");
    expect(kbVersionForHost("crm.example.com")).toBe("unknown");
  });

  it("prefers what a check's files showed over the user's choice", () => {
    rememberKbVersion("crm.example.com", "5.x", "evidence");
    rememberKbVersion("crm.example.com", "4.x", "user");
    expect(kbVersionForHost("crm.example.com")).toBe("5.x");
    rememberKbVersion("crm.example.com", "unknown", "evidence");
    expect(kbVersionForHost("crm.example.com")).toBe("5.x");
    rememberKbVersion("crm.example.com", "4.x", "evidence");
    expect(kbVersionForHost("crm.example.com")).toBe("4.x");
  });
});
