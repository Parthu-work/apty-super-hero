import { describe, expect, it } from "vitest";
import { exportHeader, withExportHeader } from "./export-header";

const NOW = new Date("2026-10-10T08:00:00.000Z");

describe("export header", () => {
  it("names the mode and the time", () => {
    expect(exportHeader("standard", NOW)).toBe(
      "Apty Agent export · redaction mode: standard · 2026-10-10T08:00:00.000Z",
    );
  });

  it("treats a missing mode as strict, the default", () => {
    expect(exportHeader(undefined, NOW)).toContain("redaction mode: strict");
  });

  it("puts the header and a blank line before the content", () => {
    expect(withExportHeader("body", "off", NOW)).toBe(
      "Apty Agent export · redaction mode: off · 2026-10-10T08:00:00.000Z\n\nbody",
    );
  });
});
