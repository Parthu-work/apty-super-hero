import { describe, expect, it } from "vitest";
import { requirePinnedVersion } from "./quickjs-manager";

describe("requirePinnedVersion", () => {
  it("accepts an unscoped package with a pinned version", () => {
    expect(() => requirePinnedVersion("lodash@4.17.21")).not.toThrow();
  });

  it("accepts a scoped package with a pinned version", () => {
    expect(() => requirePinnedVersion("@babel/core@7.29.6")).not.toThrow();
  });

  it("accepts a pinned version with a subpath", () => {
    expect(() => requirePinnedVersion("lodash@4.17.21/fp")).not.toThrow();
    expect(() =>
      requirePinnedVersion("@babel/core@7.29.6/lib/index"),
    ).not.toThrow();
  });

  it("rejects an unscoped package with no version", () => {
    expect(() => requirePinnedVersion("lodash")).toThrow(/must pin/);
  });

  it("rejects a scoped package with no version", () => {
    expect(() => requirePinnedVersion("@babel/core")).toThrow(/must pin/);
  });

  it("rejects an unscoped package with a subpath but no version", () => {
    expect(() => requirePinnedVersion("lodash/fp")).toThrow(/must pin/);
  });

  it("rejects a malformed scoped specifier with no package segment", () => {
    expect(() => requirePinnedVersion("@scope")).toThrow(/must pin/);
  });
});
