import { describe, expect, it } from "vitest";
import type { ApplicationAuditResult } from "./application-scoring";
import type { DomHealthAuditResult } from "./dom-health-scoring";
import { resolveThresholds } from "./dom-health-thresholds";
import type { RouteProbeReport } from "./route-probe";
import {
  buildValidationBundle,
  chromeVersionFrom,
  VALIDATION_BUNDLE_SCHEMA,
} from "./validation-bundle";

const NAME = "Jane Doe";
const RECORD = "48151623";
const EMAIL = "jane.doe@example.com";
const TITLE = "Chart for Jane Doe";
const INPUT_VALUE = "allergic to penicillin";
const COOKIE = "sessionid=abc123def456";
const PHI = [NAME, "Jane", RECORD, EMAIL, TITLE, INPUT_VALUE, COOKIE];

const CHART_URL = `https://athena.example.test/chart/${RECORD}/summary?patient=Jane%20Doe&email=${encodeURIComponent(EMAIL)}#/encounter/${RECORD}?name=Jane`;

/** A result-shaped fixture with PHI-like strings in fields the bundle reads and in fields it must never read. */
function pageResult(): DomHealthAuditResult {
  return {
    title: TITLE,
    url: CHART_URL,
    score: 72,
    grade: "GOOD",
    confidence: "MEDIUM",
    evidenceState: "SUFFICIENT",
    confidenceCaps: ["1 of 3 frames could not be read."],
    frameAccessibility: {
      framesTotal: 3,
      framesAccessible: 2,
      framesFailed: 1,
      framesInaccessible: 0,
    },
    frames: [
      {
        frameId: 0,
        parentFrameId: -1,
        key: "top",
        keySource: "top",
        keyStable: true,
        role: "chrome",
        roleReason: "Navigation or status frame (topnav).",
        urlTemplate: CHART_URL,
        status: "captured",
      },
      {
        frameId: 4,
        parentFrameId: 0,
        key: TITLE,
        keySource: "title",
        keyStable: false,
        role: "application",
        roleReason: "Holds application content.",
        urlTemplate: `https://athena.example.test/patients/${RECORD}?q=${NAME}`,
        status: "failed",
        error: `No answer for ${EMAIL}`,
        score: 61,
        performance: {
          timings: { totalMs: 812 },
          longestSliceMs: 40,
          partialReasons: [],
        },
      },
    ],
    coverage: {
      elementsAnalyzed: 40,
      interactiveElementsInPage: 55,
      analysis: { candidatesFound: 55, candidatesAnalyzed: 40, capped: true },
    },
    excludedRoots: [
      {
        matcher: "id:pendo-",
        owner: "Pendo",
        evidence: "repository",
        roots: 1,
        elementCount: 12,
        sampleText: NAME,
      },
    ],
    duplicateIds: {
      valuesDuplicatedWithinARoot: 1,
      valuesDuplicatedPageWide: 2,
      elementsWithDuplicatedId: 5,
      samples: [{ id: `patient-${RECORD}` }],
    },
    virtualized: {
      containers: 1,
      observedItems: 40,
      declaredTotal: 1000,
      samples: [{ signals: ["aria-count"], label: NAME }],
    },
    performance: {
      timings: { totalMs: 2400 },
      longestSliceMs: 50,
      longestStepMs: 300,
      limits: { timeBudgetMs: 6000 },
      partialReasons: [],
    },
    elementSamples: [
      {
        tagName: "input",
        bestSelector: `input[value="${INPUT_VALUE}"]`,
        text: NAME,
      },
    ],
    cookies: COOKIE,
  } as unknown as DomHealthAuditResult;
}

function applicationResult(): ApplicationAuditResult {
  return {
    score: 70,
    grade: "GOOD",
    confidence: "LOW",
    evidenceState: "SUFFICIENT",
    confidenceCaps: [],
    coverage: {
      pagesDiscovered: 3,
      pagesAudited: 2,
      pagesFailed: 0,
      pagesSkippedUnsafe: 1,
      pagesSkippedDuplicate: 0,
      pagesNotDiscovered: 0,
      coveragePercent: 67,
      framesDiscovered: 3,
      framesInspected: 2,
      framesInaccessible: 1,
    },
    stateGraph: {
      nodes: [{ title: TITLE }, { title: NAME }],
      edges: [{ label: `Open ${NAME}` }],
      routeConfidence: "LOW",
    },
    traversal: {
      mode: "click-first",
      reason: "2 of 3 observed transitions kept the same URL template.",
      clicksAllowed: true,
      evidence: { edges: 3, sameUrlEdges: 2 },
      history: [{ label: NAME }],
    },
    pages: [
      {
        url: CHART_URL,
        title: TITLE,
        discoverySource: "seed",
        status: "completed",
        navigationModel: {
          usesHistoryApiRouting: true,
          historyApiCallCount: 2,
        },
        result: pageResult(),
      },
    ],
  } as unknown as ApplicationAuditResult;
}

function probeReport(): RouteProbeReport {
  return {
    startedAt: 1,
    steps: [
      {
        index: 1,
        trigger: "click",
        clickLabel: { text: `Open ${NAME}`, hash: "c1" },
        capturedAt: 2,
        frames: [
          {
            frameId: 4,
            parentFrameId: 0,
            url: CHART_URL,
            urlHash: "u1",
            status: "captured",
            title: { text: TITLE, hash: "t1" },
            heading: { text: NAME, hash: "h1" },
            activeNav: { text: "Chart", hash: "n1" },
            owner: { ospId: "GlobalWrapper", title: { text: NAME } },
            historyApiCallCount: 1,
            pushStateCount: 1,
            firstRequest: {
              initiatorType: "fetch",
              path: `/api/patients/${RECORD}?email=${EMAIL}`,
              msAfterClick: 120,
            },
          },
        ],
      },
    ],
    analysis: {
      clicks: 1,
      hint: "click-first",
      reasons: ["The URL did not change on 1 of 1 clicks."],
      signals: [],
    },
  } as unknown as RouteProbeReport;
}

function bundleFor() {
  return buildValidationBundle({
    page: pageResult(),
    application: applicationResult(),
    probe: probeReport(),
    thresholds: resolveThresholds({
      sameUrlRatioForClickFirst: 0.4,
      bogus: 1,
    }),
    versions: { extension: "1.2.3", chrome: "130.0.6723.58" },
    generatedAt: new Date("2026-01-02T03:04:05Z"),
  });
}

describe("buildValidationBundle", () => {
  it("leaks no names, record numbers, emails, titles, input values or cookies", () => {
    const json = JSON.stringify(bundleFor());
    for (const value of PHI) {
      expect(json).not.toContain(value);
    }
    expect(json).not.toContain("Jane%20Doe");
    expect(json).not.toContain(encodeURIComponent(EMAIL));
  });

  it("keeps hosts and URL templates without queries, and the structure an engineer needs", () => {
    const bundle = bundleFor();
    expect(bundle.schema).toBe(VALIDATION_BUNDLE_SCHEMA);
    expect(bundle.generatedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(bundle.versions).toEqual({
      extension: "1.2.3",
      chrome: "130.0.6723.58",
    });
    expect(bundle.hosts).toEqual(["athena.example.test"]);

    const [top, app] = bundle.page?.frames ?? [];
    expect(top?.urlTemplate).not.toContain("?");
    expect(top).toMatchObject({ key: "top", role: "chrome" });
    expect(app).toMatchObject({
      key: null,
      keySource: "title",
      role: "application",
      status: "failed",
      score: 61,
      performance: { totalMs: 812, longestSliceMs: 40 },
    });
    expect(app?.keyHash).toMatch(/\S/);
    expect(bundle.page?.overlays).toEqual([
      {
        matcher: "id:pendo-",
        owner: "Pendo",
        evidence: "repository",
        roots: 1,
        elementCount: 12,
      },
    ]);
    expect(bundle.page?.performance).toMatchObject({
      withinBudget: true,
      limits: { timeBudgetMs: 6000 },
    });
    expect(bundle.application?.states).toEqual({
      count: 2,
      transitions: 1,
      routeConfidence: "LOW",
    });
    expect(bundle.application?.traversal?.changes).toBe(1);
    expect(bundle.application?.pages[0]?.navigation).toMatchObject({
      usesHistoryApiRouting: true,
      routingEvidence: "observed",
    });

    const probeFrame = bundle.routeProbe?.steps[0]?.frames[0];
    expect(probeFrame).toMatchObject({
      titleHash: "t1",
      headingHash: "h1",
      ownerKey: "GlobalWrapper",
      pushStateCount: 1,
      firstRequest: { initiatorType: "fetch", msAfterClick: 120 },
    });
    expect(probeFrame?.firstRequest?.path).not.toContain("?");
    expect(bundle.routeProbe?.steps[0]?.clickLabelHash).toBe("c1");
  });

  it("lists every threshold, the active override and the rejected one", () => {
    const bundle = bundleFor();
    expect(
      bundle.thresholds.find((t) => t.name === "sameUrlRatioForClickFirst"),
    ).toMatchObject({ value: 0.4, default: 0.5, overridden: true });
    expect(bundle.thresholdOverrides).toEqual({
      active: [{ name: "sameUrlRatioForClickFirst", value: 0.4, default: 0.5 }],
      rejected: [{ name: "bogus", reason: "unknown threshold" }],
    });
  });

  it("builds from a route probe alone", () => {
    const bundle = buildValidationBundle({
      probe: probeReport(),
      thresholds: resolveThresholds({}),
      versions: { extension: "1.2.3", chrome: null },
    });
    expect(bundle.page).toBeNull();
    expect(bundle.application).toBeNull();
    expect(bundle.routeProbe?.analysis.hint).toBe("click-first");
    expect(bundle.thresholdOverrides).toEqual({ active: [], rejected: [] });
  });
});

describe("chromeVersionFrom", () => {
  it("reads Chrome's version from a user agent, or null", () => {
    expect(
      chromeVersionFrom(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Safari/537.36",
      ),
    ).toBe("130.0.6723.58");
    expect(chromeVersionFrom("Mozilla/5.0 Firefox/130.0")).toBeNull();
  });
});
