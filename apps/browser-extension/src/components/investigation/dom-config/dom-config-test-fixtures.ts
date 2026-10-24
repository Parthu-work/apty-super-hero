/** Captures and crawl outcomes shared by the DOM Config card tests. */
import {
  buildReportFromCapture,
  type DomConfigApplicationCapture,
  type DomConfigCaptureOutcome,
  type DomProfileV2,
} from "@apty/browser-runtime/apty/dom-config/index";

export const ORIGIN = "https://app.example.test";
export const TAB_ID = 5;

export function profile(attributes: DomProfileV2["attributes"]): DomProfileV2 {
  return {
    schema: 2,
    tags: { html: 1, head: 1, body: 1, div: 4 },
    attributes,
    maxZIndex: 10,
    zIndexSources: [],
    frames: [],
    shadow: [],
    meta: {
      elementCount: 7,
      urlShape: `${ORIGIN}/home`,
      aptyPresent: false,
      extensionNoisePresent: false,
    },
  };
}

export function runOf(
  label: "initial" | "after-reload",
  load: number,
): DomConfigApplicationCapture["pages"][number]["runs"][number] {
  return {
    meta: {
      label,
      capturedAt: `2026-10-24T08:0${load}:00.000Z`,
      urlShape: `${ORIGIN}/home`,
      aptyPresent: false,
      extensionNoisePresent: false,
    },
    profile: profile({
      id: { [`ui-id-${load}`]: 1, [`ui-id-${load + 1}`]: 1, main: 1 },
      href: { [`/a?nocache=${load}`]: 1 },
      "data-row-id": { "98765": 1 },
      "aria-expanded": { true: 1 },
      name: { search: 1 },
    }),
  };
}

export const CAPTURE: DomConfigApplicationCapture = {
  applicationName: "app.example.test",
  pages: [
    {
      pageId: `${ORIGIN}/home`,
      label: `${ORIGIN}/home`,
      runs: [runOf("initial", 1), runOf("after-reload", 3)],
    },
  ],
};

export function outcome(
  patch: Partial<Extract<DomConfigCaptureOutcome, { available: true }>> = {},
): DomConfigCaptureOutcome {
  return {
    available: true,
    capture: CAPTURE,
    inventory: [],
    states: [
      {
        pageId: `${ORIGIN}/home`,
        runs: CAPTURE.pages[0]!.runs,
        frames: [],
        revisitIssue: null,
        failedRuns: [],
      },
    ],
    limitsReached: { maxPages: false, maxTotalMs: false },
    aborted: false,
    returnedToSeed: { success: true, reason: null },
    ...buildReportFromCapture(CAPTURE),
    ...patch,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
