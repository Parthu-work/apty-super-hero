import type { DiagnosticEvidence } from "@apty/browser-runtime";
import { describe, expect, it } from "vitest";
import { deriveComponentHealth } from "./component-health";

function statusEvidence(
  overrides: Partial<DiagnosticEvidence> & {
    source: DiagnosticEvidence["source"];
    type: string;
    data: unknown;
  },
): DiagnosticEvidence {
  return {
    evidenceId: `ev-${Math.random()}`,
    timestamp: 1000,
    tabId: 1,
    scope: "tab",
    ...overrides,
  };
}

describe("deriveComponentHealth — unified Apty Client/Widget/Player + Studio grouping", () => {
  it("returns exactly two groups, never four separate rows", () => {
    const health = deriveComponentHealth([]);

    expect(health).toHaveLength(2);
    expect(health.map((c) => c.kind)).toEqual([
      "apty-client-widget-player",
      "apty-studio",
    ]);
    expect(health[0]?.label).toBe("Apty Client / Widget / Player");
    expect(health[1]?.label).toBe("Apty Studio");
  });

  it("reports not_checked for both groups when no evidence exists", () => {
    const health = deriveComponentHealth([]);

    for (const group of health) {
      expect(group.state).toBe("not_checked");
    }
  });

  it("nests Client/Widget/Service-Worker as sub-components under the runtime group", () => {
    const health = deriveComponentHealth([]);
    const runtime = health.find((c) => c.kind === "apty-client-widget-player")!;

    expect(runtime.subComponents.map((s) => s.key)).toEqual([
      "apty-client",
      "apty-widget",
      "service-worker",
    ]);
  });

  it("aggregates the runtime group as healthy when a sub-component is confirmed healthy and others are unchecked", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-widget",
        type: "widget-status",
        data: { status: "ok", loaded: true, initialized: true },
      }),
    ]);

    const runtime = health.find((c) => c.kind === "apty-client-widget-player")!;
    expect(runtime.state).toBe("healthy");
    expect(
      runtime.subComponents.find((s) => s.key === "apty-widget")?.state,
    ).toBe("healthy");
    expect(
      runtime.subComponents.find((s) => s.key === "apty-client")?.state,
    ).toBe("not_checked");
  });

  it("aggregates the runtime group as error when any sub-component errors, even if another is healthy", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-widget",
        type: "widget-status",
        data: { status: "ok", loaded: true, initialized: true },
      }),
      statusEvidence({
        source: "service-worker",
        type: "service-worker-status",
        data: { status: "error", error: "Malformed response" },
      }),
    ]);

    const runtime = health.find((c) => c.kind === "apty-client-widget-player")!;
    expect(runtime.state).toBe("error");
    expect(runtime.detail).toContain("Malformed response");
  });

  it("aggregates the runtime group as warning when a sub-component is ok but not initialized", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-client",
        type: "client-status",
        data: { status: "ok", initialized: false },
      }),
    ]);

    const runtime = health.find((c) => c.kind === "apty-client-widget-player")!;
    expect(runtime.state).toBe("warning");
  });

  it("keeps Studio as its own group, unaffected by runtime health", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-widget",
        type: "widget-status",
        data: { status: "error", error: "Something broke" },
      }),
      statusEvidence({
        source: "apty-studio",
        type: "studio-status",
        data: { status: "ok", active: true },
      }),
    ]);

    const studio = health.find((c) => c.kind === "apty-studio")!;
    expect(studio.state).toBe("healthy");
    expect(studio.subComponents).toHaveLength(1);
  });

  it("reports not_configured for the runtime group when the only checked sub-component is not configured", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-widget",
        type: "widget-status",
        data: { status: "not_configured" },
      }),
    ]);

    const runtime = health.find((c) => c.kind === "apty-client-widget-player")!;
    expect(runtime.state).toBe("not_configured");
  });

  it("uses only the most recent status per sub-component", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-client",
        type: "client-status",
        timestamp: 100,
        data: { status: "ok", initialized: false },
      }),
      statusEvidence({
        source: "apty-client",
        type: "client-status",
        timestamp: 500,
        data: { status: "ok", initialized: true, version: "2.1.0" },
      }),
    ]);

    const client = health
      .find((c) => c.kind === "apty-client-widget-player")!
      .subComponents.find((s) => s.key === "apty-client")!;
    expect(client.state).toBe("healthy");
    expect(client.detail).toContain("2.1.0");
    expect(client.lastCheckedAt).toBe(500);
  });

  it("ignores unrelated evidence (e.g. console logs) when deriving health", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "console",
        type: "console-error",
        data: { level: "error", message: "unrelated" },
      }),
    ]);

    expect(health.every((c) => c.state === "not_checked")).toBe(true);
  });
});
