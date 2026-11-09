import { describe, expect, it } from "vitest";
import { looks4x, playerVersionOf } from "./pack-kit.js";
import type { ClientEvidence } from "./types.js";

const seen = (...observedNames: string[]): ClientEvidence => ({
  connection: { ok: true },
  observedNames,
  files: {},
});

describe("playerVersionOf", () => {
  it("does not call a tenant 5.x from the files both players read", () => {
    expect(playerVersionOf(seen("app-urls.json", "app-data.json"))).toBe(
      "unknown",
    );
    expect(looks4x(seen("app-urls.json", "app-data.json"))).toBe(false);
  });

  it("tells 4.x from a 4.x-only file next to the shared ones", () => {
    for (const marker of [
      "flow.json",
      "segments.json",
      "rules.json",
      "feature-flag.json",
      "flow-18515.json",
      "flow-0c000000-0000-7000-8000-000000000002.json",
    ]) {
      const evidence = seen("app-urls.json", "app-data.json", marker);
      expect(playerVersionOf(evidence), marker).toBe("4.x");
      expect(looks4x(evidence), marker).toBe(true);
    }
  });

  it("tells 5.x from a 5.x-only file next to the shared ones", () => {
    for (const marker of ["workflow.json", "segment.json", "rule.json"]) {
      const evidence = seen("app-urls.json", "app-data.json", marker);
      expect(playerVersionOf(evidence), marker).toBe("5.x");
      expect(looks4x(evidence), marker).toBe(false);
    }
  });

  it("says unknown when files of both players were observed", () => {
    const both = seen("app-urls.json", "flow.json", "workflow.json");
    expect(playerVersionOf(both)).toBe("unknown");
    expect(looks4x(both)).toBe(false);
  });

  it("does not take a 5.x workflow's steps file for a 4.x flow file", () => {
    expect(
      playerVersionOf(
        seen("workflow-0c000000-0000-7000-8000-000000000002.json"),
      ),
    ).toBe("unknown");
  });

  it("does not take config.json, which a tenant's calls do not carry, as a 4.x marker", () => {
    expect(playerVersionOf(seen("config.json"))).toBe("unknown");
  });
});
