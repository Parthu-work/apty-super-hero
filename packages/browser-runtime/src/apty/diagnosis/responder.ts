import type { LocalResponder } from "@apty/agent-core";
import { getAptyIntegrationConfig } from "../config.js";
import type { DomHealthAuditOutcome } from "../dom-health.js";
import { tabElementProbeOf } from "../element-probe.js";
import { diagnoseContentNotVisible, filesFor } from "./content-not-visible.js";
import {
  diagnoseElementNotFound,
  elementFilesFor,
  type Probe,
  stepFileFor,
} from "./element-not-found.js";
import { languageName } from "./languages.js";
import { loadClientEvidence } from "./loader.js";
import { loadLogEvidence } from "./log-loader.js";
import { diagnoseLogsAndErrors } from "./logs-and-errors.js";
import { diagnosePageReadiness } from "./page-readiness.js";
import { type Route, routeSymptom } from "./router.js";
import type {
  ClientEvidence,
  DiagnosisResult,
  LogEvidence,
  NextCheck,
  NotChecked,
} from "./types.js";
import {
  diagnoseWidgetNotVisible,
  WIDGET_FILES,
} from "./widget-not-visible.js";

export const RUN_DIAGNOSIS = "run_diagnosis";

const MAX_SCAN_ROWS_IN_TRANSCRIPT = 30;

const NEXT_CHECK_TEXT: Record<NextCheck, string> = {
  fixConnection:
    "Fix the connection to the Apty Client first; this is not evidence about the content.",
  reload: "Reload the problem page, then check again.",
  readStatus:
    "An empty list has several causes (nothing published here, a failed load, a failed schema check): read its status code and the Console next.",
  fixRequest: "Fix the failing request first.",
  waitForLoad: "Wait for the page to finish loading, then check again.",
  denyList:
    "Remove the entry from Settings > Data handling > body deny list to let this file be checked.",
  bodyLimit:
    "The Client did not keep this body (size limit or eviction). Reload and check again, or paste the file.",
  openResponse: "Open the response and see what the server returned.",
  manual4x: "Use the manual paste path for 4.x.",
  nameItem: "Name the item that is missing to check it in full.",
  whichOne: "Give the full name or the sourceId of the one that is missing.",
  testAsMember:
    "Test as a user known to match the segment, and confirm the widget shows for that user.",
  openAppPage:
    "Open the application page where the widget is missing in this tab, then ask again.",
  comparePatterns:
    "Compare the URL patterns of the environments that match this page in Admin; make the one that should not win more specific.",
  removalTest:
    "Disable or remove Apty and repeat the exact flow: if the same 404s still occur, they are not Apty's.",
  readConsoleText:
    "Read the exact CSP text in the Console: a nonce means a player version with nonce support, a plain block means whitelisting.",
  openItems: "Then check the open items, which the files cannot decide.",
  sendSupport:
    "Send support the Apty version, the environment name, the sourceId, a screenshot of the open widget and the trimmed entry with its request URL and status.",
  runInConsole:
    "Run the item's jQuery or custom-script selector in the Console on this page and see whether it returns the intended element.",
  openItemPage:
    "Open the page where the content should show in this tab, then ask again.",
  reloadAndRetest:
    "Reload the page and ask again: a selector holding a generated value often stops matching after a reload.",
  playWorkflow:
    "Play the workflow once in this tab, so the Apty Client loads its steps, then ask again.",
  nameStep:
    'Name the step that fails ("step 3"), with the page where it fails open in this tab.',
  checkTiming:
    "Check that the element is there when the content runs (Apty retries once a second for 5 seconds), and that the item is published here and its segment matches.",
};

const NOT_CHECKED_TEXT: Record<NotChecked, string> = {
  membership: "whether this user matches a segment's rule",
  "runtime-rules": "the visibility, later and recurrence rules",
  "widget-css": "whether the page's CSS hides the widget container",
  "extension-page-console":
    "what Apty logs in the page in Extension mode, which runs where the agent cannot read",
  cors: "CORS blocks, which the browser does not report to the page",
  "element-timing":
    "whether the element is on the page at the moment the content runs",
  "closed-shadow-roots":
    "elements inside closed shadow roots, which neither Apty nor the agent can open",
  canvas: "content drawn on a canvas, which has no elements to select",
};

function subjectLine(result: DiagnosisResult): string {
  const { subject } = result;
  if (subject.kind === "widget") return "Widget visibility check";
  if (subject.kind === "logs") return "Logs and errors check";
  if (result.packId === "page-readiness") return "Page selection check";
  if (result.packId === "element-not-found") {
    return `Selector check of ${subject.kind}${subject.query ? ` "${subject.query}"` : ""}`;
  }
  const language = subject.language
    ? ` for ${languageName(subject.language)} users`
    : "";
  return `Visibility check of ${subject.kind}${subject.query ? ` "${subject.query}"` : "s"}${language}`;
}

/** What the session keeps of a check, for the model to read on later turns. */
export function transcriptOf(result: DiagnosisResult): string {
  const { verdict } = result;
  const lines = [
    `${subjectLine(result)} from ${result.packId === "page-readiness" ? "DOM Health's audit of the page" : "the Apty Client's files"} (KB card ${result.cardPageId}; ${result.verifiedOn}).`,
    `Result: ${verdict.status.replace(/_/g, " ")}. ${verdict.headline}`,
    ...verdict.causes.map(
      (c) => `- ${c.ruleId}: ${c.summary} Fix: ${c.fix} (card ${c.cardPageId})`,
    ),
    ...result.gates
      .filter((g) => g.status === "unknown")
      .map((g) => `- Open: ${g.detail}`),
    ...(result.scan?.rows
      .filter((r) => r.blockers.length > 0)
      .slice(0, MAX_SCAN_ROWS_IN_TRANSCRIPT)
      .map((r) => `- ${r.name}: ${r.blockers.join(", ")}`) ?? []),
    ...(verdict.nextCheck
      ? [`Next: ${NEXT_CHECK_TEXT[verdict.nextCheck]}`]
      : []),
    ...(result.notChecked.length > 0
      ? [
          `Not checked from the files: ${result.notChecked.map((n) => NOT_CHECKED_TEXT[n]).join("; ")}.`,
        ]
      : []),
  ];
  return lines.join("\n");
}

/** The URL of the tab the conversation is bound to; it is only matched here, never sent. */
export async function tabUrlOf(
  runContext: unknown,
): Promise<string | undefined> {
  const tabId = (runContext as { tabId?: unknown } | undefined)?.tabId;
  if (typeof tabId !== "number" || typeof chrome === "undefined") {
    return undefined;
  }
  try {
    return (await chrome.tabs.get(tabId)).url;
  } catch {
    return undefined;
  }
}

/** Where the packs read the user's page: its URL, its console, its frames and its DOM Health. */
export interface PageSources {
  pageUrl: () => Promise<string | undefined>;
  pageConsole: () => Promise<LogEvidence["page"]>;
  probeElement: Probe;
  domHealth: () => Promise<DomHealthAuditOutcome | undefined>;
}

/** The Client's files for the selector check, with a workflow's own steps file when the Client has loaded it. */
async function elementEvidence(
  clientExtensionId: string | undefined,
  kind: Extract<Route, { packId: "element-not-found" }>["kind"],
  query: string | undefined,
): Promise<ClientEvidence> {
  const evidence = await loadClientEvidence(
    clientExtensionId,
    elementFilesFor(kind),
  );
  const stepFile =
    kind === "workflow" ? stepFileFor(evidence, query) : undefined;
  if (!stepFile) return evidence;
  const steps = await loadClientEvidence(clientExtensionId, [stepFile]);
  return { ...evidence, files: { ...evidence.files, ...steps.files } };
}

/** Runs the routed pack on the Client's files, logs and calls, and the page. */
export async function runPack(
  route: Route,
  clientExtensionId: string | undefined,
  { pageUrl, pageConsole, probeElement, domHealth }: PageSources,
): Promise<DiagnosisResult> {
  if (route.packId === "page-readiness") {
    return diagnosePageReadiness(await domHealth());
  }
  if (route.packId === "element-not-found") {
    const evidence = await elementEvidence(
      clientExtensionId,
      route.kind,
      route.query,
    );
    return diagnoseElementNotFound(
      evidence,
      {
        kind: route.kind,
        ...(route.query ? { query: route.query } : {}),
        ...(route.step ? { step: route.step } : {}),
      },
      probeElement,
    );
  }
  if (route.packId === "logs-and-errors") {
    const evidence = await loadLogEvidence(clientExtensionId, pageConsole);
    return diagnoseLogsAndErrors(evidence, route.about404);
  }
  if (route.packId === "widget-not-visible") {
    const evidence = await loadClientEvidence(clientExtensionId, WIDGET_FILES);
    return diagnoseWidgetNotVisible(evidence, await pageUrl());
  }
  const evidence = await loadClientEvidence(
    clientExtensionId,
    filesFor(route.kind),
  );
  return diagnoseContentNotVisible(
    evidence,
    route.kind,
    route.query,
    route.language,
  );
}

function paramsOf(route: Route) {
  if (route.packId === "widget-not-visible") return { kind: "widget" };
  if (route.packId === "page-readiness") return { kind: "page" };
  if (route.packId === "element-not-found") {
    return {
      kind: route.kind,
      problem: "element-not-found",
      ...(route.query ? { name: route.query } : {}),
      ...(route.step ? { step: route.step } : {}),
    };
  }
  if (route.packId === "logs-and-errors") {
    return { kind: "logs", ...(route.about404 ? { about404: true } : {}) };
  }
  return {
    kind: route.kind,
    ...(route.query ? { name: route.query } : {}),
    ...(route.language ? { language: route.language } : {}),
  };
}

/** Where the responder reads the Client's ID and, for the conversation's tab, each page source. */
export interface ResponderSources {
  clientExtensionId: () => Promise<string | undefined>;
  pageUrlOf: (runContext: unknown) => Promise<string | undefined>;
  pageConsoleOf: (runContext: unknown) => Promise<LogEvidence["page"]>;
  elementProbeOf: (runContext: unknown) => Probe;
  domHealthOf: (
    runContext: unknown,
  ) => Promise<DomHealthAuditOutcome | undefined>;
}

const DEFAULT_SOURCES: ResponderSources = {
  clientExtensionId: async () =>
    (await getAptyIntegrationConfig()).clientExtensionId,
  pageUrlOf: tabUrlOf,
  pageConsoleOf: async () => undefined,
  elementProbeOf: tabElementProbeOf,
  domHealthOf: async () => undefined,
};

/**
 * Answers a message the router recognises from the Apty Client's files and
 * the page in the conversation's tab, so the chat can show the check
 * without a model call. Anything else returns undefined and goes to the
 * model.
 */
export function createDiagnosisResponder(
  overrides: Partial<ResponderSources> = {},
): LocalResponder {
  const sources = { ...DEFAULT_SOURCES, ...overrides };
  return async (input, { runContext }) => {
    const route = routeSymptom(input);
    if (!route) return undefined;
    const result = await runPack(route, await sources.clientExtensionId(), {
      pageUrl: () => sources.pageUrlOf(runContext),
      pageConsole: () => sources.pageConsoleOf(runContext),
      probeElement: sources.elementProbeOf(runContext),
      domHealth: () => sources.domHealthOf(runContext),
    });
    return {
      toolName: RUN_DIAGNOSIS,
      params: paramsOf(route),
      result,
      transcript: transcriptOf(result),
    };
  };
}
