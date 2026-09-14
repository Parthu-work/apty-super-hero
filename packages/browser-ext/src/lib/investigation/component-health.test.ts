import type { DiagnosticEvidence } from "@aipexstudio/browser-runtime";
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

describe("deriveComponentHealth", () => {
  it("reports not_checked for every component when no evidence exists", () => {
    const health = deriveComponentHealth([]);

    expect(health).toHaveLength(4);
    for (const component of health) {
      expect(component.state).toBe("not_checked");
    }
    expect(health.map((c) => c.kind)).toEqual([
      "apty-client",
      "apty-widget",
      "apty-studio",
      "service-worker",
    ]);
  });

  it("reports not_configured for a widget that hasn't implemented the bridge", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-widget",
        type: "widget-status",
        data: { status: "not_configured" },
      }),
    ]);

    const widget = health.find((c) => c.kind === "apty-widget")!;
    expect(widget.state).toBe("not_configured");
  });

  it("reports healthy for an initialized widget with no error", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-widget",
        type: "widget-status",
        data: { status: "ok", loaded: true, initialized: true },
      }),
    ]);

    expect(health.find((c) => c.kind === "apty-widget")?.state).toBe("healthy");
  });

  it("reports warning for a widget that is ok but not yet initialized", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-widget",
        type: "widget-status",
        data: { status: "ok", loaded: true, initialized: false },
      }),
    ]);

    expect(health.find((c) => c.kind === "apty-widget")?.state).toBe("warning");
  });

  it("reports warning for a widget with a lastError even if initialized", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-widget",
        type: "widget-status",
        data: {
          status: "ok",
          initialized: true,
          lastError: "Failed to render tooltip",
        },
      }),
    ]);

    const widget = health.find((c) => c.kind === "apty-widget")!;
    expect(widget.state).toBe("warning");
    expect(widget.detail).toBe("Failed to render tooltip");
  });

  it("reports error when a provider reports status: error", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "service-worker",
        type: "service-worker-status",
        data: { status: "error", error: "Malformed response" },
      }),
    ]);

    const sw = health.find((c) => c.kind === "service-worker")!;
    expect(sw.state).toBe("error");
    expect(sw.detail).toBe("Malformed response");
  });

  it("reports not_detected when configured but unavailable", () => {
    const health = deriveComponentHealth([
      statusEvidence({
        source: "apty-studio",
        type: "studio-status",
        data: { status: "unavailable" },
      }),
    ]);

    expect(health.find((c) => c.kind === "apty-studio")?.state).toBe(
      "not_detected",
    );
  });

  it("uses only the most recent status per component", () => {
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

    const client = health.find((c) => c.kind === "apty-client")!;
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
