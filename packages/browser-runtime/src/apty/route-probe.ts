/**
 * DOM Health route probe: a developer tool for onboarding an application.
 *
 * Section 8 of the DOM Health brief: the exports of Infor LN and athenaOne
 * cannot say which signal changes from one screen to the next, and that
 * decides how a `RouteKey` is built and whether traversal has to go
 * click-first. The probe answers it on a live tenant. The developer clicks
 * through the application; after each of their clicks, once the page has
 * settled, it records for every frame:
 *
 * 1. the frame URL (frame 0 is the top-level URL);
 * 2. `document.title`;
 * 3. the frame element's `name`, `id`, `title` and `data-osp-id`, as read in
 *    the parent document;
 * 4. the first API call or frame load after the click (path only, from the
 *    page's resource timing; nothing is intercepted, network capture stays
 *    off);
 * 5. the first heading and the active navigation item, read through shadow
 *    roots;
 * 6. how many `pushState` calls the page made (counted in the MAIN world).
 *
 * `analyzeRouteProbe` then says which of those changed, on how many clicks.
 *
 * The probe never clicks anything, never navigates, and records only
 * trusted (user) clicks in the probed tab. Every value is redacted the way
 * DOM Health results are (`dom-health-redaction.ts`). Page text (titles,
 * headings, nav labels, clicked labels) is shown on screen in redacted form
 * and compared by hash; `toShareableRouteProbeReport` drops that text
 * before anything is saved.
 */

import { redactAuditUrl, redactDomText } from "./dom-health-redaction.js";
import { collectFrameOwnersByFrameId } from "./frame-audit.js";
import type { FrameOwnerAttributes } from "./frame-identity.js";
import { getFrameTree, sendFrameMessage } from "./frame-tree.js";
import { waitForDomStable } from "./page-navigation.js";
import { fnv1a } from "./state-fingerprint.js";

const CAPTURE_TIMEOUT_MS = 3000;
const SETTLE_QUIET_MS = 400;
const SETTLE_TIMEOUT_MS = 8000;

/** Redacted text for display, and a hash of the raw value so two steps can be compared without keeping it. */
export interface ProbeText {
  text: string;
  hash: string;
}

export interface RouteProbeFrameOwner {
  tagName: "iframe" | "frame";
  name: ProbeText | null;
  id: string | null;
  title: ProbeText | null;
  ospId: string | null;
  hasSrcAttribute: boolean;
  rendered: boolean;
}

export interface RouteProbeRequest {
  origin: string;
  path: string;
  initiatorType: string;
  msAfterClick: number;
}

export interface RouteProbeFrameRecord {
  frameId: number;
  parentFrameId: number;
  url: string;
  urlHash: string;
  status: "captured" | "failed";
  error?: string;
  title: ProbeText | null;
  heading: ProbeText | null;
  activeNav: ProbeText | null;
  /** The element that hosts this frame, as its parent document reports it. Null for the top frame, or when the parent could not be read (cross-origin parents still answer; only an unreachable parent leaves this null). */
  owner: RouteProbeFrameOwner | null;
  historyApiCallCount: number | null;
  pushStateCount: number | null;
  firstRequest: RouteProbeRequest | null;
}

export interface RouteProbeStep {
  index: number;
  trigger: "start" | "click";
  clickLabel: ProbeText | null;
  capturedAt: number;
  frames: RouteProbeFrameRecord[];
  /** Set when the frame tree itself could not be read for this step. */
  error?: string;
}

export type RouteProbeSignal =
  | "topUrl"
  | "frameUrls"
  | "frameSet"
  | "title"
  | "heading"
  | "activeNav"
  | "firstRequest"
  | "pushState";

export interface RouteProbeSignalSummary {
  signal: RouteProbeSignal;
  /** Clicks after which this signal differed from the step before. */
  changedOnClicks: number;
  /** Distinct values seen across all steps (for `firstRequest` and `pushState`: clicks where it was present). */
  distinctValues: number;
}

export type TraversalModeHint = "url-first" | "click-first" | "undetermined";

export interface RouteProbeAnalysis {
  clicks: number;
  signals: RouteProbeSignalSummary[];
  hint: TraversalModeHint;
  reasons: string[];
}

export interface RouteProbeReport {
  startedAt: number;
  steps: RouteProbeStep[];
  analysis: RouteProbeAnalysis;
}

interface CapturedOwner {
  frameId: number | null;
  tagName: "iframe" | "frame";
  name: string | null;
  id: string | null;
  title: string | null;
  ospId: string | null;
  srcAttribute: string | null;
  rendered: boolean;
}

interface CapturedFrame {
  url: string;
  title: string;
  firstHeading: string | null;
  activeNavItem: string | null;
  owners: CapturedOwner[];
  historyApiCallCount: number;
  pushStateCount: number;
  firstRequest: RouteProbeRequest | null;
}

function probeText(raw: string): ProbeText {
  return { text: redactDomText(raw), hash: fnv1a(raw) };
}

function optionalProbeText(raw: string | null): ProbeText | null {
  return raw ? probeText(raw) : null;
}

function redactRequest(request: RouteProbeRequest): RouteProbeRequest {
  try {
    const url = new URL(redactAuditUrl(`${request.origin}${request.path}`));
    return { ...request, path: url.pathname };
  } catch {
    return { ...request, path: redactDomText(request.path) };
  }
}

function toOwner(owner: FrameOwnerAttributes): RouteProbeFrameOwner {
  return {
    tagName: owner.tagName,
    name: optionalProbeText(owner.name),
    id: owner.id ? redactDomText(owner.id) : null,
    title: optionalProbeText(owner.title),
    ospId: owner.ospId ? redactDomText(owner.ospId) : null,
    hasSrcAttribute: owner.srcAttribute !== null,
    rendered: owner.rendered,
  };
}

/**
 * Capture one probe step across every frame in the tab. Frames are asked
 * one by one by `frameId`; one that does not answer is recorded as failed
 * with the reason, never dropped.
 */
export async function captureRouteProbeStep(
  tabId: number,
  index: number,
  trigger: RouteProbeStep["trigger"],
  clickLabel: string | null,
): Promise<RouteProbeStep> {
  const step: RouteProbeStep = {
    index,
    trigger,
    clickLabel: optionalProbeText(clickLabel),
    capturedAt: Date.now(),
    frames: [],
  };
  const frames = await getFrameTree(tabId);
  if (!frames) {
    step.error = "The tab's frames could not be listed.";
    return step;
  }

  const results = await Promise.all(
    frames.map(async (frame) => ({
      frame,
      result: await sendFrameMessage<CapturedFrame>(
        tabId,
        frame.frameId,
        { request: "dom-health-probe-capture" },
        CAPTURE_TIMEOUT_MS,
      ),
    })),
  );

  // The same join the audit uses: `chrome.runtime.getFrameId` where the
  // content script has it, then the frame's own description, its name, its
  // URL and document order (`collectFrameOwnersByFrameId`).
  const ownersByFrameId = await collectFrameOwnersByFrameId(tabId, frames);

  step.frames = results.map(({ frame, result }) => {
    const owner = ownersByFrameId.get(frame.frameId);
    const data = result.success ? result.data : undefined;
    return {
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      url: redactAuditUrl(data?.url || frame.url),
      urlHash: fnv1a(data?.url || frame.url),
      status: data ? "captured" : "failed",
      ...(data ? {} : { error: result.error ?? "No answer from this frame." }),
      title: data ? probeText(data.title) : null,
      heading: data ? optionalProbeText(data.firstHeading) : null,
      activeNav: data ? optionalProbeText(data.activeNavItem) : null,
      owner: owner ? toOwner(owner) : null,
      historyApiCallCount: data?.historyApiCallCount ?? null,
      pushStateCount: data?.pushStateCount ?? null,
      firstRequest: data?.firstRequest
        ? redactRequest(data.firstRequest)
        : null,
    };
  });
  return step;
}

async function forEachFrame(tabId: number, request: string): Promise<void> {
  const frames = (await getFrameTree(tabId)) ?? [];
  await Promise.all(
    frames.map((frame) =>
      sendFrameMessage(tabId, frame.frameId, { request }, CAPTURE_TIMEOUT_MS),
    ),
  );
}

function sortedJoin(values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .join("|");
}

function capturedFrames(step: RouteProbeStep): RouteProbeFrameRecord[] {
  return step.frames.filter((frame) => frame.status === "captured");
}

/** The value of each comparable signal in one step, as a string key (hashes, never raw text). */
function signalKeys(
  step: RouteProbeStep,
): Record<Exclude<RouteProbeSignal, "firstRequest" | "pushState">, string> {
  const frames = capturedFrames(step);
  const top = frames.find((frame) => frame.frameId === 0);
  return {
    topUrl: top?.urlHash ?? "",
    frameUrls: sortedJoin(frames.map((frame) => frame.urlHash)),
    frameSet: sortedJoin(
      frames.map((frame) =>
        frame.owner
          ? `${frame.owner.ospId ?? ""}/${frame.owner.id ?? ""}/${frame.owner.title?.hash ?? ""}`
          : null,
      ),
    ),
    title: sortedJoin(frames.map((frame) => frame.title?.hash)),
    heading: sortedJoin(frames.map((frame) => frame.heading?.hash)),
    activeNav: sortedJoin(frames.map((frame) => frame.activeNav?.hash)),
  };
}

function pushStateTotal(step: RouteProbeStep): number {
  return capturedFrames(step).reduce(
    (sum, frame) => sum + (frame.pushStateCount ?? 0),
    0,
  );
}

/**
 * Which signals changed from each step to the next, and a hint for the
 * traversal mode. The hint is the brief's section 8 rule applied
 * literally: URLs that change on most clicks suggest URL-first; headings,
 * nav or titles changing while URLs stay put suggest click-first; nothing
 * changing on most clicks leaves only structural identity, so the hint is
 * "undetermined". "Most" is more than half: a threshold chosen here, not
 * measured on a real tenant.
 */
export function analyzeRouteProbe(steps: RouteProbeStep[]): RouteProbeAnalysis {
  const keyed = steps.map(signalKeys);
  const comparable = Object.keys(keyed[0] ?? {}) as Array<
    keyof ReturnType<typeof signalKeys>
  >;
  const clicks = Math.max(0, steps.length - 1);
  const changed = new Map<RouteProbeSignal, number>();
  let firstRequestClicks = 0;
  let pushStateClicks = 0;

  for (let i = 1; i < steps.length; i++) {
    for (const signal of comparable) {
      if (keyed[i]![signal] !== keyed[i - 1]![signal]) {
        changed.set(signal, (changed.get(signal) ?? 0) + 1);
      }
    }
    if (capturedFrames(steps[i]!).some((frame) => frame.firstRequest)) {
      firstRequestClicks++;
    }
    if (pushStateTotal(steps[i]!) > pushStateTotal(steps[i - 1]!)) {
      pushStateClicks++;
    }
  }

  const signals: RouteProbeSignalSummary[] = [
    ...comparable.map((signal) => ({
      signal,
      changedOnClicks: changed.get(signal) ?? 0,
      distinctValues: new Set(keyed.map((keys) => keys[signal])).size,
    })),
    {
      signal: "firstRequest" as const,
      changedOnClicks: firstRequestClicks,
      distinctValues: firstRequestClicks,
    },
    {
      signal: "pushState" as const,
      changedOnClicks: pushStateClicks,
      distinctValues: pushStateClicks,
    },
  ];

  const count = (signal: RouteProbeSignal) =>
    signals.find((s) => s.signal === signal)?.changedOnClicks ?? 0;
  const most = (n: number) => clicks > 0 && n > clicks / 2;
  const urlChanges = Math.max(count("topUrl"), count("frameUrls"));
  const contentChanges = Math.max(
    count("heading"),
    count("activeNav"),
    count("title"),
  );
  const reasons: string[] = [];
  let hint: TraversalModeHint = "undetermined";
  if (clicks === 0) {
    reasons.push("No clicks were recorded after the starting step.");
  } else if (most(urlChanges)) {
    hint = "url-first";
    reasons.push(
      `A top-level or frame URL changed on ${urlChanges} of ${clicks} clicks.`,
    );
  } else if (most(contentChanges)) {
    hint = "click-first";
    reasons.push(
      `URLs changed on ${urlChanges} of ${clicks} clicks, but the heading, active navigation item or title changed on ${contentChanges}.`,
    );
  } else {
    reasons.push(
      `Neither URLs (${urlChanges} of ${clicks}) nor headings, navigation or titles (${contentChanges} of ${clicks}) changed on most clicks; only structural identity is left.`,
    );
  }
  if (count("pushState") > 0) {
    reasons.push(
      `The page called history.pushState after ${count("pushState")} of ${clicks} clicks.`,
    );
  }
  if (count("firstRequest") > 0) {
    reasons.push(
      `An API call or frame load followed ${count("firstRequest")} of ${clicks} clicks.`,
    );
  }
  return { clicks, signals, hint, reasons };
}

/**
 * The report as it may be saved or shared: page text (titles, headings,
 * nav labels, clicked labels, frame names and titles) reduced to its hash,
 * since a redacted name is still a name. URLs, request paths and frame
 * ids stay, already redacted.
 */
export function toShareableRouteProbeReport(
  report: RouteProbeReport,
): RouteProbeReport {
  const hashOnly = (value: ProbeText | null): ProbeText | null =>
    value ? { text: "", hash: value.hash } : null;
  return {
    ...report,
    steps: report.steps.map((step) => ({
      ...step,
      clickLabel: hashOnly(step.clickLabel),
      frames: step.frames.map((frame) => ({
        ...frame,
        title: hashOnly(frame.title),
        heading: hashOnly(frame.heading),
        activeNav: hashOnly(frame.activeNav),
        owner: frame.owner
          ? {
              ...frame.owner,
              name: hashOnly(frame.owner.name),
              title: hashOnly(frame.owner.title),
            }
          : null,
      })),
    })),
  };
}

export interface RouteProbeSession {
  stop(): Promise<RouteProbeReport>;
}

/**
 * Start probing `tabId`: capture the starting step, then one step after
 * each user click in that tab, once the page has settled. Steps are
 * captured one at a time, in click order.
 */
export async function startRouteProbe(
  tabId: number,
  onStep: (step: RouteProbeStep) => void,
): Promise<RouteProbeSession> {
  const startedAt = Date.now();
  const steps: RouteProbeStep[] = [];
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;

  const record = (trigger: RouteProbeStep["trigger"], label: string | null) => {
    queue = queue.then(async () => {
      if (stopped) return;
      if (trigger === "click") {
        await waitForDomStable(tabId, SETTLE_QUIET_MS, SETTLE_TIMEOUT_MS);
      }
      const step = await captureRouteProbeStep(
        tabId,
        steps.length,
        trigger,
        label,
      );
      if (stopped) return;
      steps.push(step);
      onStep(step);
      await forEachFrame(tabId, "dom-health-probe-arm");
    });
    return queue;
  };

  const onMessage = (
    message: { request?: string; label?: unknown },
    sender: chrome.runtime.MessageSender,
  ) => {
    if (message?.request !== "dom-health-probe-click") return;
    if (sender.tab?.id !== tabId) return;
    void record(
      "click",
      typeof message.label === "string" ? message.label : null,
    );
  };

  await forEachFrame(tabId, "dom-health-probe-arm");
  chrome.runtime.onMessage.addListener(onMessage);
  await record("start", null);

  return {
    async stop() {
      chrome.runtime.onMessage.removeListener(onMessage);
      await queue;
      stopped = true;
      await forEachFrame(tabId, "dom-health-probe-disarm");
      return { startedAt, steps, analysis: analyzeRouteProbe(steps) };
    },
  };
}
