import type { LocalResponder } from "@apty/agent-core";
import { siteHostOf } from "../../conversation/site-host.js";
import type { KbToolResult } from "../../kb/kb-index.js";
import { type KbMatchesOptions, localKbMatches } from "../../kb/kb-matches.js";
import { kbVersionForUrl, rememberKbVersion } from "../../kb/kb-version.js";
import { getRedactionMode } from "../../runtime/redaction-mode.js";
import { applyResultPrivacy } from "../../runtime/result-privacy.js";
import { currentValuePolicy } from "../../runtime/value-policy.js";
import { getAptyIntegrationConfig } from "../config.js";
import type { DomHealthAuditOutcome } from "../dom-health.js";
import { tabElementProbeOf } from "../element-probe.js";
import { readAptyFilesForTab } from "./apty-files.js";
import { diagnoseContentNotVisible, filesFor } from "./content-not-visible.js";
import {
  DAPTY_FILES,
  diagnoseDaptyConversation,
} from "./dapty-conversation.js";
import {
  createDaptyTrace,
  type DaptyTrace,
  summarizeDaptyTrace,
} from "./dapty-evidence.js";
import { loadDaptyFromClient } from "./dapty-loader.js";
import { asksAboutDapty } from "./dapty-route.js";
import { readDaptyFilesForTab, readDaptyForTab } from "./dapty-sources.js";
import type { DaptyEvidence } from "./dapty-types.js";
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
import { playerVersionOf } from "./pack-kit.js";
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
  askRegexFlag:
    "Ask whether this tenant has the regex URL feature flags on (urlRegex for the application, regExpUrl for the environment; both are off by default): they decide which environment this page gets, and the files cannot tell.",
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
  askDapty:
    "Open the widget's Ask Dapty chat on the page in this tab, ask the question again, then check again.",
  checkKb:
    "Check what this application's AI knowledge holds in Admin (documents and connected repositories), and whether it covers the question.",
  clickAsUser:
    "Ask Dapty again as the user, on the page where the item's visibility rule should pass, and click the suggestion.",
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
  "screen-token":
    "whether the screen on display has the screen token an element was captured with, which the application's own script computes",
  canvas: "content drawn on a canvas, which has no elements to select",
  "kb-contents":
    "what the indexed documents say, which only ai-service can search",
  "suggestion-ids":
    "the suggestions' ids, which the chat panel does not show, so they were matched by name",
};

function subjectLine(result: DiagnosisResult): string {
  const { subject } = result;
  if (subject.kind === "widget") return "Widget visibility check";
  if (subject.kind === "logs") return "Logs and errors check";
  if (result.packId === "page-readiness") return "Page selection check";
  if (result.packId === "dapty-conversation") return "Ask Dapty chat check";
  if (result.packId === "element-not-found") {
    return `Selector check of ${subject.kind}${subject.query ? ` ${JSON.stringify(subject.query)}` : ""}`;
  }
  const language = subject.language
    ? ` for ${languageName(subject.language)} users`
    : "";
  return `Visibility check of ${subject.kind}${subject.query ? ` ${JSON.stringify(subject.query)}` : "s"}${language}`;
}

/** Where a check read its files: the live Apty Client, or a HAR file the SE picked. */
export type EvidenceSource = "client" | "har";

const DAPTY_CHAT_FROM = {
  client: "the Apty Client's record of the chat",
  har: "the HAR file's chat calls",
  page: "the page's chat calls",
  cdn: "the stored chat on Apty's content CDN",
  "widget-dom": "the widget's chat panel",
} as const;

const CDN_FILES = "the content files on Apty's content CDN";

function readFrom(result: DiagnosisResult, source: EvidenceSource): string {
  if (result.packId === "page-readiness")
    return "DOM Health's audit of the page";
  if (result.dapty) {
    const files =
      result.dapty.source === "har"
        ? "Apty files"
        : result.filesFromCdn
          ? CDN_FILES
          : "the Apty Client's files";
    return `${DAPTY_CHAT_FROM[result.dapty.source]} and ${files}`;
  }
  if (source === "har") return "the HAR file's Apty files";
  return result.filesFromCdn ? CDN_FILES : "the Apty Client's files";
}

/** What the session keeps of a check, for the model to read on later turns. */
export function transcriptOf(
  result: DiagnosisResult,
  source: EvidenceSource = "client",
): string {
  const { verdict } = result;
  const lines = [
    `${subjectLine(result)} from ${readFrom(result, source)} (${result.cardPageId ? `KB card ${result.cardPageId}; ` : ""}${result.verifiedOn}).`,
    `Result: ${verdict.status.replace(/_/g, " ")}. ${verdict.headline}`,
    ...(result.dapty?.lastQuestion
      ? [
          `The user's last question to Dapty: ${JSON.stringify(result.dapty.lastQuestion)}`,
        ]
      : []),
    ...verdict.causes.map(
      (c) =>
        `- ${c.ruleId}: ${c.summary} Fix: ${c.fix}${c.cardPageId ? ` (card ${c.cardPageId})` : ""}`,
    ),
    ...(result.dapty?.suggestions.map(
      (r) =>
        `- Suggested ${JSON.stringify(r.name)}: ${r.status}${r.rule ? ` (visibility rule ${JSON.stringify(r.rule)})` : ""}${r.listHidden ? ", hidden from the widget's list" : ""}`,
    ) ?? []),
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
  /** The Ask Dapty chat; by default as the Apty Client recorded it. */
  dapty?: (trace?: DaptyTrace) => Promise<DaptyEvidence>;
  /** The Ask Dapty check's content files; by default the Apty Client's. */
  daptyFiles?: (trace?: DaptyTrace) => Promise<ClientEvidence>;
  /** Every other check's content files; by default the Apty Client's. */
  files?: (names: readonly string[]) => Promise<ClientEvidence>;
}

/** A route the chat or `run_diagnosis` can run: the router's, or the Ask Dapty check. */
export type CheckRoute = Route | { packId: "dapty-conversation" };

/** The Client's files for the selector check, with a workflow's own steps file when the Client has loaded it. */
async function elementEvidence(
  load: (names: readonly string[]) => Promise<ClientEvidence>,
  kind: Extract<Route, { packId: "element-not-found" }>["kind"],
  query: string | undefined,
): Promise<ClientEvidence> {
  const evidence = await load(elementFilesFor(kind));
  const stepFile =
    kind === "workflow" ? stepFileFor(evidence, query) : undefined;
  if (!stepFile) return evidence;
  const steps = await load([stepFile]);
  return { ...evidence, files: { ...evidence.files, ...steps.files } };
}

/** What the files tell of the tenant's Apty version, kept for the KB searches on this site (K12). */
async function noteVersion(
  evidence: ClientEvidence,
  pageUrl: () => Promise<string | undefined>,
): Promise<void> {
  rememberKbVersion(
    siteHostOf(await pageUrl()),
    playerVersionOf(evidence),
    "evidence",
  );
}

/** The result, saying when its files came from Apty's content CDN. */
const fromCdn = (result: DiagnosisResult, evidence: ClientEvidence) =>
  evidence.fromCdn ? { ...result, filesFromCdn: true } : result;

/**
 * Runs the routed pack on the Client's files, logs and calls, and the page.
 * With a trace, the Ask Dapty result also carries how each source was read
 * (`daptyEvidence`), for the card's evidence bundle.
 */
export async function runPack(
  route: CheckRoute,
  clientExtensionId: string | undefined,
  {
    pageUrl,
    pageConsole,
    probeElement,
    domHealth,
    dapty,
    daptyFiles,
    files,
  }: PageSources,
  trace?: DaptyTrace,
): Promise<DiagnosisResult> {
  const load =
    files ?? ((names) => loadClientEvidence(clientExtensionId, names));
  if (route.packId === "dapty-conversation") {
    const [chat, evidence, page] = await Promise.all([
      dapty ? dapty(trace) : loadDaptyFromClient(clientExtensionId, trace),
      daptyFiles ? daptyFiles(trace) : load(DAPTY_FILES),
      pageUrl(),
    ]);
    const result = fromCdn(
      diagnoseDaptyConversation(chat, evidence, page),
      evidence,
    );
    return trace
      ? { ...result, daptyEvidence: summarizeDaptyTrace(trace, chat, evidence) }
      : result;
  }
  if (route.packId === "page-readiness") {
    return diagnosePageReadiness(await domHealth());
  }
  if (route.packId === "element-not-found") {
    const evidence = await elementEvidence(load, route.kind, route.query);
    await noteVersion(evidence, pageUrl);
    return fromCdn(
      await diagnoseElementNotFound(
        evidence,
        {
          kind: route.kind,
          ...(route.query ? { query: route.query } : {}),
          ...(route.step ? { step: route.step } : {}),
        },
        probeElement,
      ),
      evidence,
    );
  }
  if (route.packId === "logs-and-errors") {
    const evidence = await loadLogEvidence(clientExtensionId, pageConsole);
    return diagnoseLogsAndErrors(evidence, route.about404);
  }
  if (route.packId === "widget-not-visible") {
    const evidence = await load(WIDGET_FILES);
    await noteVersion(evidence, pageUrl);
    return fromCdn(
      diagnoseWidgetNotVisible(evidence, await pageUrl()),
      evidence,
    );
  }
  const evidence = await load(filesFor(route.kind));
  await noteVersion(evidence, pageUrl);
  return fromCdn(
    diagnoseContentNotVisible(
      evidence,
      route.kind,
      route.query,
      route.language,
    ),
    evidence,
  );
}

function paramsOf(route: CheckRoute) {
  if (route.packId === "dapty-conversation") return { kind: "dapty" };
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
  /** The Ask Dapty chat for the conversation's tab; undefined reads the Apty Client's record. */
  daptyOf?: (
    runContext: unknown,
    clientExtensionId: string | undefined,
    trace?: DaptyTrace,
  ) => Promise<DaptyEvidence>;
  /** Its content files; undefined reads the Apty Client's. */
  daptyFilesOf?: (
    runContext: unknown,
    clientExtensionId: string | undefined,
    trace?: DaptyTrace,
  ) => Promise<ClientEvidence>;
  /** The KB pack's cards for a message no check pack claims (KB-RAG K6, K16). */
  kbMatchesOf?: (
    input: string,
    options: KbMatchesOptions,
  ) => Promise<KbToolResult | undefined>;
  /** Whether a model is configured: a question the cards cannot match then goes to it. */
  modelAvailable?: () => boolean;
  /** Every other check's content files for the tab; undefined reads the Apty Client's. */
  filesOf?: (
    runContext: unknown,
    clientExtensionId: string | undefined,
    names: readonly string[],
  ) => Promise<ClientEvidence>;
}

const DEFAULT_SOURCES: ResponderSources = {
  clientExtensionId: async () =>
    (await getAptyIntegrationConfig()).clientExtensionId,
  pageUrlOf: tabUrlOf,
  pageConsoleOf: async () => undefined,
  elementProbeOf: tabElementProbeOf,
  domHealthOf: async () => undefined,
  daptyOf: readDaptyForTab,
  daptyFilesOf: readDaptyFilesForTab,
  filesOf: readAptyFilesForTab,
  kbMatchesOf: (input, options) => localKbMatches(input, undefined, options),
};

const SEARCH_KB = "search_kb";

/** A message no check pack claims, answered from the KB pack's cards with no model call. */
async function kbAnswer(
  input: string,
  sources: ResponderSources,
  runContext: unknown,
) {
  const matches = await sources.kbMatchesOf?.(input, {
    modelAvailable: sources.modelAvailable?.() ?? false,
    version: kbVersionForUrl(await sources.pageUrlOf(runContext)),
  });
  if (!matches) return undefined;
  await getRedactionMode();
  const policy = currentValuePolicy();
  const shown = applyResultPrivacy(matches, policy) as KbToolResult;
  return {
    toolName: SEARCH_KB,
    params: applyResultPrivacy(
      { query: input.slice(0, 300), topK: 3 },
      policy,
    ) as { query: string; topK: number },
    result: shown,
    transcript: JSON.stringify(shown),
  };
}

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
    const route: CheckRoute | undefined = asksAboutDapty(input)
      ? { packId: "dapty-conversation" }
      : routeSymptom(input);
    if (!route) return kbAnswer(input, sources, runContext);
    const trace =
      route.packId === "dapty-conversation" ? createDaptyTrace() : undefined;
    const clientExtensionId = await sources.clientExtensionId();
    const { daptyOf, daptyFilesOf, filesOf } = sources;
    const result = await runPack(
      route,
      clientExtensionId,
      {
        pageUrl: () => sources.pageUrlOf(runContext),
        pageConsole: () => sources.pageConsoleOf(runContext),
        probeElement: sources.elementProbeOf(runContext),
        domHealth: () => sources.domHealthOf(runContext),
        ...(daptyOf
          ? {
              dapty: (t?: DaptyTrace) =>
                daptyOf(runContext, clientExtensionId, t),
            }
          : {}),
        ...(daptyFilesOf
          ? {
              daptyFiles: (t?: DaptyTrace) =>
                daptyFilesOf(runContext, clientExtensionId, t),
            }
          : {}),
        ...(filesOf
          ? {
              files: (names: readonly string[]) =>
                filesOf(runContext, clientExtensionId, names),
            }
          : {}),
      },
      trace,
    );
    // The URL policy every tool result gets on its way to the model
    // (tools/index.ts): the answer is kept in the session and read next turn.
    await getRedactionMode();
    const policy = currentValuePolicy();
    const shown = applyResultPrivacy(result, policy) as DiagnosisResult;
    return {
      toolName: RUN_DIAGNOSIS,
      params: applyResultPrivacy(paramsOf(route), policy) as ReturnType<
        typeof paramsOf
      >,
      result: shown,
      transcript: applyResultPrivacy(transcriptOf(shown), policy) as string,
    };
  };
}
