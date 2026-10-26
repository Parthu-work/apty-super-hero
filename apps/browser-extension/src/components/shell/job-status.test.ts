import { describe, expect, it, vi } from "vitest";

// The DOM health store reads the runtime only when a check runs.
vi.mock("@apty/browser-runtime", () => ({}));

import { englishTranslate as t } from "../../services/model-list";
import {
  createDomConfigStore,
  type DomConfigState,
} from "../investigation/dom-config/dom-config-store";
import {
  createDomHealthStore,
  type DomHealthState,
} from "../investigation/dom-health-store";
import { domConfigStatus, domHealthStatus, elapsedLabel } from "./job-status";

const health = (patch: Partial<DomHealthState>): DomHealthState => ({
  ...createDomHealthStore().getState(),
  ...patch,
});
const config = (patch: Partial<DomConfigState>): DomConfigState => ({
  ...createDomConfigStore().getState(),
  ...patch,
});
const status = ({ tone, label, running }: ReturnType<typeof domHealthStatus>) =>
  [tone, label, running] as const;

describe("domHealthStatus", () => {
  it.each([
    ["not checked", health({}), ["neutral", "Not checked", false]],
    [
      "a single page running, with no page count",
      health({ running: "page" }),
      ["info", "Running", true],
    ],
    [
      "the application audit on its third page",
      health({
        running: "application",
        scope: "application",
        progress: {
          phase: "auditing",
          url: "https://app.example.com/c",
          pageIndex: 2,
          pagesQueued: 4,
        },
      }),
      ["info", "Page 3", true],
    ],
    [
      "a score and its grade",
      health({
        pageOutcome: { available: true, score: 61, grade: "FAIR" } as never,
      }),
      ["warning", "61 · Fair", false],
    ],
    [
      "no score, only the grade",
      health({
        pageOutcome: {
          available: true,
          score: null,
          grade: "NOT_ASSESSED",
        } as never,
      }),
      ["neutral", "Not assessed", false],
    ],
    [
      "the application result when it is the one shown",
      health({
        scope: "application",
        pageOutcome: { available: true, score: 61, grade: "FAIR" } as never,
        appOutcome: { available: true, score: 92, grade: "EXCELLENT" } as never,
      }),
      ["success", "92 · Excellent", false],
    ],
    [
      "a check that could not finish",
      health({ pageOutcome: { available: false, error: "No page" } }),
      ["danger", "Couldn't finish", false],
    ],
  ])("%s", (_case, state, expected) => {
    expect(status(domHealthStatus(state, t))).toEqual(expected);
  });
});

describe("domConfigStatus", () => {
  const report = {} as DomConfigState["report"];
  // The crawl numbers its pages from 1.
  const capturing = {
    phase: "capturing" as const,
    stateIndex: 4,
    maxStates: 20,
    urlShape: "/orders",
    runIndex: 1,
    runCount: 2,
    runLabel: "after-reload" as const,
  };
  it.each([
    ["not generated", config({}), ["neutral", "Not generated", false]],
    [
      "running before the first page",
      config({ phase: "running" }),
      ["info", "Running", true],
    ],
    [
      "capturing page 4 of 20",
      config({
        phase: "running",
        current: capturing,
        lastCapture: capturing,
      }),
      ["info", "Page 4 of 20", true],
    ],
    [
      "discovering links after page 4, still on page 4",
      config({
        phase: "running",
        current: { phase: "discovering", urlShape: "/orders" },
        lastCapture: capturing,
      }),
      ["info", "Page 4 of 20", true],
    ],
    ["stopping", config({ phase: "stopping" }), ["info", "Stopping", true]],
    [
      "results held, never exported",
      config({ phase: "report", report }),
      ["warning", "Not exported", false],
    ],
    [
      "results exported",
      config({ phase: "report", report, exportedAt: 1 }),
      ["success", "Exported", false],
    ],
    [
      "a crawl that could not finish",
      config({ phase: "failed", error: "Tab closed" }),
      ["danger", "Couldn't finish", false],
    ],
  ])("%s", (_case, state, expected) => {
    expect(status(domConfigStatus(state, t))).toEqual(expected);
  });
});

describe("elapsedLabel", () => {
  it.each([
    [0, "0:00"],
    [9_400, "0:09"],
    [192_000, "3:12"],
    [-5_000, "0:00"],
  ])("%i ms reads %s", (ms, label) => {
    expect(elapsedLabel(1_000_000, 1_000_000 + ms)).toBe(label);
  });
});
