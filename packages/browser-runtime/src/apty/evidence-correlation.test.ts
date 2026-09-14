import { describe, expect, it } from "vitest";
import { correlateEvidence, formatTimeline } from "./evidence-correlation";
import type { DiagnosticEvidence } from "./types";

let seq = 0;
function evidence(overrides: Partial<DiagnosticEvidence>): DiagnosticEvidence {
  seq += 1;
  return {
    evidenceId: `ev-${seq}`,
    source: "console",
    type: "console-error",
    timestamp: 1_000_000,
    scope: "tab",
    tabId: 1,
    data: {},
    ...overrides,
  };
}

describe("correlateEvidence", () => {
  it("returns one cluster per evidence item when nothing is related", () => {
    const items = [
      evidence({ timestamp: 0, tabId: 1 }),
      evidence({ timestamp: 100_000, tabId: 1 }),
      evidence({ timestamp: 300_000, tabId: 1 }),
    ];

    const clusters = correlateEvidence(items);

    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.evidence.length === 1)).toBe(true);
  });

  it("groups events on the same tab within the time window into one cluster", () => {
    const items = [
      evidence({
        source: "network",
        type: "network-http-error",
        timestamp: 1000,
        tabId: 5,
      }),
      evidence({
        source: "console",
        type: "console-error",
        timestamp: 1500,
        tabId: 5,
      }),
    ];

    const clusters = correlateEvidence(items, { windowMs: 2000 });

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.evidence).toHaveLength(2);
  });

  it("does not group events on different tabs even within the time window", () => {
    const items = [
      evidence({ timestamp: 1000, tabId: 1 }),
      evidence({ timestamp: 1500, tabId: 2 }),
    ];

    const clusters = correlateEvidence(items, { windowMs: 2000 });

    expect(clusters).toHaveLength(2);
  });

  it("groups events sharing a requestId regardless of time gap", () => {
    const items = [
      evidence({
        source: "network",
        type: "network-request",
        timestamp: 0,
        tabId: 1,
        requestId: "req-1",
      }),
      evidence({
        source: "network",
        type: "network-http-error",
        timestamp: 60_000,
        tabId: 1,
        requestId: "req-1",
      }),
    ];

    const clusters = correlateEvidence(items, { windowMs: 500 });

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.evidence).toHaveLength(2);
  });

  it("groups events sharing a correlationId regardless of tab or time gap", () => {
    const items = [
      evidence({ timestamp: 0, tabId: 1, correlationId: "workflow-step-3" }),
      evidence({
        timestamp: 500_000,
        tabId: 9,
        correlationId: "workflow-step-3",
      }),
    ];

    const clusters = correlateEvidence(items, { windowMs: 100 });

    expect(clusters).toHaveLength(1);
  });

  it("groups shared/global evidence (e.g. service-worker logs) with tab-scoped evidence in the same window", () => {
    const items = [
      evidence({
        source: "service-worker",
        type: "service-worker-error",
        timestamp: 1000,
        tabId: null,
        scope: "shared",
      }),
      evidence({
        source: "console",
        type: "console-error",
        timestamp: 1200,
        tabId: 7,
      }),
    ];

    const clusters = correlateEvidence(items, { windowMs: 2000 });

    expect(clusters).toHaveLength(1);
  });

  it("flags a cluster as likely the same incident when it spans a network failure and a console/runtime error", () => {
    const items = [
      evidence({
        source: "network",
        type: "network-http-error",
        timestamp: 0,
        tabId: 1,
      }),
      evidence({
        source: "console",
        type: "console-error",
        timestamp: 300,
        tabId: 1,
      }),
    ];

    const [cluster] = correlateEvidence(items);

    expect(cluster?.likelySameIncident).toBe(true);
    expect(cluster?.summary).toMatch(/likely the same failure/i);
  });

  it("does not flag a cluster as likely-same-incident when all evidence is from one source", () => {
    const items = [
      evidence({
        source: "console",
        type: "console-error",
        timestamp: 0,
        tabId: 1,
      }),
      evidence({
        source: "console",
        type: "console-warn",
        timestamp: 300,
        tabId: 1,
      }),
    ];

    const [cluster] = correlateEvidence(items);

    expect(cluster?.likelySameIncident).toBe(false);
  });

  it("returns clusters sorted by start time regardless of input order", () => {
    const items = [
      evidence({ timestamp: 5000, tabId: 1 }),
      evidence({ timestamp: 0, tabId: 2 }),
      evidence({ timestamp: 2500, tabId: 3 }),
    ];

    const clusters = correlateEvidence(items, { windowMs: 1 });

    expect(clusters.map((c) => c.startTimestamp)).toEqual([0, 2500, 5000]);
  });

  it("handles an empty evidence list", () => {
    expect(correlateEvidence([])).toEqual([]);
  });
});

describe("formatTimeline", () => {
  it("reports no evidence for an empty cluster list", () => {
    expect(formatTimeline([])).toMatch(/no evidence/i);
  });

  it("renders each cluster with its evidence indented underneath, marking likely-incident clusters", () => {
    const items = [
      evidence({
        source: "network",
        type: "network-http-error",
        timestamp: 0,
        tabId: 1,
      }),
      evidence({
        source: "console",
        type: "console-error",
        timestamp: 300,
        tabId: 1,
      }),
    ];
    const clusters = correlateEvidence(items);

    const timeline = formatTimeline(clusters);

    expect(timeline).toContain("⚠️");
    expect(timeline).toContain("[network] network-http-error");
    expect(timeline).toContain("[console] console-error");
  });
});
