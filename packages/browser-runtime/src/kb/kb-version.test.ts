import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetKbVersions,
  kbVersionForHost,
  kbVersionSourceForHost,
  rememberKbVersion,
  resolveKbVersionFromClient,
  versionFromFileNames,
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

describe("the version from the Client's files (KB-RAG K27, F7)", () => {
  it("reads the K13 markers: 4.x, 5.x, or unknown when both or neither", () => {
    expect(versionFromFileNames(["app.json", "flow.json"])).toBe("4.x");
    expect(versionFromFileNames(["segments.json", "rules.json"])).toBe("4.x");
    expect(versionFromFileNames(["workflow.json", "segment.json"])).toBe("5.x");
    expect(versionFromFileNames(["flow.json", "workflow.json"])).toBe(
      "unknown",
    );
    expect(versionFromFileNames(["app.json"])).toBe("unknown");
  });

  it("resolves a site once, asks again for a new site, and gives way to the SE's choice", async () => {
    forgetKbVersions();
    const names = vi.fn(async () => ["flow.json"]);
    await resolveKbVersionFromClient("one.example.com", names);
    await resolveKbVersionFromClient("one.example.com", names);
    expect(names).toHaveBeenCalledTimes(1);
    expect(kbVersionForHost("one.example.com")).toBe("4.x");
    expect(kbVersionSourceForHost("one.example.com")).toBe("client");
    rememberKbVersion("one.example.com", "5.x", "user");
    expect(kbVersionForHost("one.example.com")).toBe("5.x");

    await resolveKbVersionFromClient("two.example.com", async () => [
      "workflow.json",
    ]);
    expect(kbVersionForHost("two.example.com")).toBe("5.x");

    const later = vi.fn(async () => undefined);
    await resolveKbVersionFromClient("three.example.com", later);
    await resolveKbVersionFromClient("three.example.com", later);
    expect(later).toHaveBeenCalledTimes(2);
  });
});
