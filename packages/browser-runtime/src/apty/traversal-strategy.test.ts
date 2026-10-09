import { describe, expect, it } from "vitest";
import type { FrameSignatureEntry } from "./route-key.js";
import {
  chooseTraversalMode,
  corroboratingSignals,
  describeCorroboration,
  EMPTY_TRAVERSAL_EVIDENCE,
  frameSrcChanges,
  newRequestTemplates,
} from "./traversal-strategy.js";

function frame(
  frameKey: string,
  url: string,
  frameRole: FrameSignatureEntry["frameRole"] = "application",
): FrameSignatureEntry {
  return {
    frameId: 1,
    frameKey,
    frameKeyStable: true,
    frameRole,
    depth: 1,
    urlTemplate: url,
    signature: { url, navTrail: [], primaryHeading: null, structureHash: "" },
  };
}

describe("chooseTraversalMode", () => {
  it("chooses click-first for a seed shaped like the LN top document: no links, two navigation controls", () => {
    const decision = chooseTraversalMode({
      ...EMPTY_TRAVERSAL_EVIDENCE,
      seedLinkTemplates: 0,
      seedNavigationCandidates: 2,
    });

    expect(decision.mode).toBe("click-first");
    expect(decision.reason).toContain("0 distinct link target(s)");
  });

  it("chooses url-first when links lead to distinct URL templates", () => {
    expect(
      chooseTraversalMode({
        ...EMPTY_TRAVERSAL_EVIDENCE,
        seedLinkTemplates: 4,
        seedNavigationCandidates: 6,
      }).mode,
    ).toBe("url-first");
  });

  it("stays url-first for a page with neither links nor controls", () => {
    expect(chooseTraversalMode(EMPTY_TRAVERSAL_EVIDENCE).mode).toBe(
      "url-first",
    );
  });

  it("switches to click-first once most observed transitions keep the URL", () => {
    const evidence = {
      ...EMPTY_TRAVERSAL_EVIDENCE,
      seedLinkTemplates: 4,
      edges: 3,
      sameUrlEdges: 2,
    };

    expect(chooseTraversalMode(evidence).mode).toBe("click-first");
    expect(
      chooseTraversalMode({ ...evidence, edges: 2, sameUrlEdges: 2 }).mode,
    ).toBe("url-first");
  });

  it("switches to click-first as soon as loading a recorded URL fails to reproduce its screen", () => {
    const decision = chooseTraversalMode({
      ...EMPTY_TRAVERSAL_EVIDENCE,
      seedLinkTemplates: 4,
      urlRestorations: 2,
      urlRestorationFailures: 1,
    });

    expect(decision.mode).toBe("click-first");
    expect(decision.reason).toContain("1 of 2 direct loads");
  });
});

describe("transition corroboration", () => {
  it("counts a frame that appeared or loaded a new URL template, never a shim", () => {
    const before = [
      frame("GlobalNav", "https://ehr.example.test/4242424/2/nav", "chrome"),
      frame("GlobalWrapper", "https://ehr.example.test/4242424/2/home"),
    ];
    const after = [
      frame("GlobalNav", "https://ehr.example.test/4242424/2/nav", "chrome"),
      frame("GlobalWrapper", "https://ehr.example.test/4242424/2/registration"),
      frame("searchmenuiframe", "https://ehr.example.test/blank", "shim"),
    ];

    expect(frameSrcChanges(before, after)).toEqual(["GlobalWrapper"]);
  });

  it("ignores a record id change in a frame URL", () => {
    expect(
      frameSrcChanges(
        [frame("GlobalWrapper", "https://ehr.example.test/4242424/2/chart")],
        [frame("GlobalWrapper", "https://ehr.example.test/1234567/2/chart")],
      ),
    ).toEqual([]);
  });

  it("counts only requests the page was not already making before the click", () => {
    const poll = {
      url: "https://app.example.test/api/heartbeat?t=1",
      timestamp: 1,
    };

    expect(
      newRequestTemplates(
        [poll],
        [
          { ...poll, timestamp: 5 },
          { url: "https://app.example.test/api/4242424/orders", timestamp: 6 },
          { url: "https://app.example.test/api/1234567/orders", timestamp: 7 },
        ],
      ),
    ).toEqual(["https://app.example.test/api/:id/orders"]);
  });

  it("says when network capture was off instead of claiming no requests", () => {
    const corroboration = {
      historyEvents: 0,
      frameSrcChanges: [],
      newRequestTemplates: null,
    };

    expect(corroboratingSignals(corroboration)).toEqual([]);
    expect(describeCorroboration(corroboration)).toBe("network capture off");
  });
});
