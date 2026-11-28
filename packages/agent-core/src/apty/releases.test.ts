import { describe, expect, it } from "vitest";
import { releaseAtLeast } from "./releases.js";

describe("releaseAtLeast", () => {
  it("compares major, minor and patch as numbers", () => {
    expect(releaseAtLeast("5.2.4", "5.2.4")).toBe(true);
    expect(releaseAtLeast("5.2.10", "5.2.4")).toBe(true);
    expect(releaseAtLeast("5.10.0", "5.2.4")).toBe(true);
    expect(releaseAtLeast("5.2.3", "5.2.4")).toBe(false);
    expect(releaseAtLeast("4.16.0", "5.2.4")).toBe(false);
    expect(releaseAtLeast("v5.3.0-beta.1", "5.2.4")).toBe(true);
  });

  it("decides nothing for a value that is not a release number", () => {
    expect(releaseAtLeast("latest", "5.2.4")).toBeUndefined();
    expect(releaseAtLeast("5.2", "5.2.4")).toBeUndefined();
  });
});
