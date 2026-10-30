/**
 * Check pack for "what do the logs say", from the Console texts the RAG
 * cards name: "No active application found" (JA 1496645690), "Error
 * fetching data" and "Error parsing response" (JA 1496253321), "[Apty] No
 * matching version found" and "[Apty] Failed to load widget snippet"
 * (JA 1496678479), CSP violations (JA 1496612958), failed content requests
 * (JA 1496351651) and suspected Apty 404s (JA 1496645781). Every rule is from
 * 5.x code at 4c406d5 or support cases, not runtime-verified, so a finding
 * is never more certain than "likely".
 *
 * It reads three sources and names each one it could not read: the Apty
 * Client's service-worker logs, the Client's own calls, and the console the
 * page-world bridge buffered in the user's tab. The bridge sees the page's
 * own scripts (Apty in Injected mode), CSP violations and resources that
 * failed to load; it cannot see what Apty logs in the page in Extension mode,
 * nor CORS blocks, which the browser does not report to the page.
 */

import { CHECK_PACK_FILES } from "./pack-files.js";
import { makeGate, quotedErrorText } from "./pack-kit.js";
import type {
  Cause,
  DiagnosisResult,
  GateId,
  GateReason,
  GateResult,
  GateStatus,
  LogEvidence,
  LogLine,
  NextCheck,
  NotChecked,
  Params,
  RuleId,
  Verdict,
} from "./types.js";

const LOGS_CARD = "1496645690";
const CARD_APP_URLS = "1496253321";
const CARD_CDN = "1496678479";
const CARD_CSP = "1496612958";
const CARD_NOT_REACHING = "1496351651";
const CARD_404 = "1496645781";
const VERIFIED_ON =
  "5.x code, commit 4c406d5, 2026-09-22, and support cases; not runtime-verified";
const MAX_EXCERPTS = 3;
const MAX_EXCERPT_CHARS = 160;

interface KnownMessage {
  ruleId: RuleId;
  reason: GateReason;
  cardPageId: string;
  pattern: RegExp;
  summary: string;
  fix: string;
}

const KNOWN: KnownMessage[] = [
  {
    ruleId: "LOG-01",
    reason: "noActiveApplication",
    cardPageId: LOGS_CARD,
    pattern:
      /No active application found|No active environment found|Error registering IoC/i,
    summary:
      "Apty found no environment whose URL pattern matches the page, so nothing loads there.",
    fix: 'Ask "the widget is not appearing" in the tab of that page to see which pattern misses it, then add the page\'s host to the right environment in Admin and publish.',
  },
  {
    ruleId: "LOG-02",
    reason: "fetchOrParseError",
    cardPageId: CARD_APP_URLS,
    pattern: /Error fetching data|Error parsing response/i,
    summary:
      "A content file failed to load or failed its schema check, and Apty then treats it as empty.",
    fix: "Read that file's status code next; if one entry is malformed, fix it in Admin and publish.",
  },
  {
    ruleId: "LOG-03",
    reason: "noMatchingVersion",
    cardPageId: CARD_CDN,
    pattern:
      /No matching version found for the current URL|Failed to load widget snippet/i,
    summary:
      "The injected loader found no environment for this URL: this is URL matching, not whitelisting.",
    fix: 'Check the environments\' URL patterns (ask "the widget is not appearing" here), and that the matching environment has a client version for Injected mode.',
  },
];

function gate(
  id: GateId,
  status: GateStatus,
  ruleId: RuleId,
  reason: GateReason,
  detail: string,
  params: Params = {},
  evidence: string[] = [],
  cardPageId = LOGS_CARD,
): GateResult {
  return makeGate(
    cardPageId,
    id,
    status,
    ruleId,
    reason,
    detail,
    params,
    evidence,
  );
}

/** A line as the card may quote it: no URL, at most a few words. */
function excerpt(line: LogLine): string {
  const text = line.message.replace(/\bhttps?:\/\/[^\s)"']+/g, "[url]");
  return text.length > MAX_EXCERPT_CHARS
    ? `${text.slice(0, MAX_EXCERPT_CHARS)}…`
    : text;
}

/** Which reader a line came from, for the card to name in the user's language. */
const sourceOf = (where: string) =>
  where === "page console" ? "page" : "client";

/** Lines another gate reports on its own: CSP violations and failed loads. */
const OWN_GATE = new Set(["csp-violation", "resource-error"]);

/** The known messages a source's lines carry, each once, with how often it appears. */
function knownIn(lines: LogLine[], where: string) {
  return KNOWN.flatMap((known) => {
    const hits = lines.filter((l) => known.pattern.test(l.message));
    if (hits.length === 0) return [];
    const phrase = known.pattern.exec(hits[0]?.message ?? "")?.[0] ?? "";
    const cause: Cause = {
      ruleId: known.ruleId,
      cardPageId: known.cardPageId,
      params: { where, source: sourceOf(where), phrase, count: hits.length },
      summary: known.summary,
      fix: known.fix,
      evidence: [`${where}: "${phrase}" (${hits.length}×)`],
    };
    return [cause];
  });
}

function errorLines(lines: LogLine[]) {
  return lines.filter(
    (l) => l.level === "error" && !OWN_GATE.has(l.source ?? ""),
  );
}

function sourceGate(
  id: GateId,
  where: string,
  lines: LogLine[],
  causes: Cause[],
): GateResult {
  if (causes.length > 0) {
    return gate(
      id,
      "fail",
      causes[0]?.ruleId ?? "LOG-01",
      KNOWN.find((k) => k.ruleId === causes[0]?.ruleId)?.reason ??
        "noActiveApplication",
      causes.map((c) => c.summary).join(" "),
      { where, source: sourceOf(where), count: causes.length },
      causes.flatMap((c) => c.evidence),
      causes[0]?.cardPageId,
    );
  }
  const errors = errorLines(lines);
  if (errors.length > 0) {
    const distinct = [...new Set(errors.map(excerpt))].slice(0, MAX_EXCERPTS);
    return gate(
      id,
      "info",
      "LOG-00",
      "errorsLogged",
      `${where}: ${errors.length} error(s), none of them a message the KB cards name.`,
      { where, source: sourceOf(where), count: errors.length },
      distinct.map((m) => `${where}: ${m}`),
    );
  }
  return gate(
    id,
    "pass",
    "LOG-00",
    "noKnownMessage",
    `${where}: ${lines.length} line(s), no error and no message the KB cards name.`,
    { where, source: sourceOf(where), count: lines.length },
  );
}

const describeCall = (c: LogEvidence["calls"][number]) =>
  `${c.name}: ${c.failed ? (c.errorText ? quotedErrorText(c.errorText) : "failed") : `HTTP ${c.status}`}`;

function callsStep(
  evidence: LogEvidence,
  about404: boolean,
): { gates: GateResult[]; causes: Cause[] } {
  const failed = evidence.calls.filter(
    (c) => c.failed || (c.status !== undefined && c.status >= 400),
  );
  const content = failed.filter((c) => CHECK_PACK_FILES.includes(c.name));
  const other = failed.filter((c) => !CHECK_PACK_FILES.includes(c.name));
  const gates: GateResult[] = [];
  const causes: Cause[] = [];
  if (content.length > 0) {
    const lines = [...new Set(content.map(describeCall))];
    const cause: Cause = {
      ruleId: "LOG-05",
      cardPageId: CARD_NOT_REACHING,
      params: { files: [...new Set(content.map((c) => c.name))].join(", ") },
      summary: `The Apty Client's request for ${[...new Set(content.map((c) => c.name))].join(", ")} failed, so the content in it does not reach the player.`,
      fix: "Fix the failing request first: a 401 or 403 points to access, a 404 to content not published to this environment, a net:: error to the network or a blocked domain.",
      evidence: lines,
    };
    causes.push(cause);
    gates.push(
      gate(
        "client-calls",
        "fail",
        "LOG-05",
        "contentCallsFailed",
        cause.summary,
        cause.params,
        lines,
        CARD_NOT_REACHING,
      ),
    );
  }
  if (other.length > 0) {
    gates.push(
      gate(
        "client-calls",
        "info",
        "LOG-05",
        "otherCallsFailed",
        `${other.length} other call(s) of the Apty Client failed.`,
        { count: other.length },
        [...new Set(other.map(describeCall))].slice(0, MAX_EXCERPTS * 2),
        CARD_NOT_REACHING,
      ),
    );
  }
  if (about404) {
    const apty404 = evidence.calls.filter((c) => c.status === 404);
    gates.push(
      apty404.length > 0
        ? gate(
            "client-calls",
            "info",
            "LOG-07",
            "apty404s",
            `${apty404.length} of the Apty Client's own calls returned 404.`,
            { count: apty404.length },
            [...new Set(apty404.map(describeCall))],
            CARD_404,
          )
        : gate(
            "client-calls",
            "unknown",
            "LOG-07",
            "no404FromApty",
            "None of the Apty Client's calls returned 404. The application's 404s are probably not Apty's: do the removal test before concluding.",
            {},
            [],
            CARD_404,
          ),
    );
  }
  if (gates.length === 0) {
    gates.push(
      gate(
        "client-calls",
        "pass",
        "LOG-05",
        "callsOk",
        `None of the Apty Client's ${evidence.calls.length} call(s) failed.`,
        { count: evidence.calls.length },
        [],
        CARD_NOT_REACHING,
      ),
    );
  }
  return { gates, causes };
}

/** CSP violations and failed resources in the page, attributed to Apty only by the Client's own hosts. */
function pageStep(
  lines: LogLine[],
  contentHosts: Set<string>,
): { gates: GateResult[]; causes: Cause[] } {
  const hostOf = (text: string) => {
    const url = /\bhttps?:\/\/[^\s)"']+/.exec(text)?.[0];
    try {
      return url ? new URL(url).host : undefined;
    } catch {
      return undefined;
    }
  };
  const isApty = (l: LogLine) => {
    const host = hostOf(l.message);
    return host !== undefined && contentHosts.has(host);
  };
  const csp = lines.filter((l) => l.source === "csp-violation");
  const failedLoads = lines.filter((l) => l.source === "resource-error");
  const gates: GateResult[] = [];
  const causes: Cause[] = [];
  const aptyCsp = csp.filter(isApty);
  if (aptyCsp.length > 0) {
    const directives = [
      ...new Set(
        aptyCsp.map(
          (l) => /CSP violation: (\S+)/.exec(l.message)?.[1] ?? "unknown",
        ),
      ),
    ].join(", ");
    const cause: Cause = {
      ruleId: "LOG-04",
      cardPageId: CARD_CSP,
      params: { count: aptyCsp.length, directives },
      summary: `The page's Content Security Policy blocked ${aptyCsp.length} load(s) from Apty's hosts (${directives}).`,
      fix: "Whitelist the Apty domains in the application's CSP. If the Console text mentions a nonce, the player needs a version with nonce support: contact support.",
      evidence: [`page: ${aptyCsp.length} CSP violation(s) for Apty's hosts`],
    };
    causes.push(cause);
    gates.push(
      gate(
        "page-console",
        "fail",
        "LOG-04",
        "cspBlockedApty",
        cause.summary,
        cause.params,
        cause.evidence,
        CARD_CSP,
      ),
    );
  } else if (csp.length > 0) {
    gates.push(
      gate(
        "page-console",
        "unknown",
        "LOG-04",
        "cspBlockedOther",
        `The page's CSP blocked ${csp.length} load(s), none from a host the Apty Client uses. In Injected mode, check whether any of them is Apty's.`,
        { count: csp.length },
        [],
        CARD_CSP,
      ),
    );
  }
  const aptyLoads = failedLoads.filter(isApty);
  if (aptyLoads.length > 0) {
    const cause: Cause = {
      ruleId: "LOG-06",
      cardPageId: CARD_CDN,
      params: { count: aptyLoads.length },
      summary: `${aptyLoads.length} resource(s) from Apty's hosts failed to load in the page.`,
      fix: "Ask the customer to whitelist the Apty CDN domains in their network or CSP policy, then reload.",
      evidence: [`page: ${aptyLoads.length} failed load(s) from Apty's hosts`],
    };
    causes.push(cause);
    gates.push(
      gate(
        "page-console",
        "fail",
        "LOG-06",
        "aptyResourceFailed",
        cause.summary,
        cause.params,
        cause.evidence,
        CARD_CDN,
      ),
    );
  }
  return { gates, causes };
}

function finish(
  evidence: LogEvidence,
  gates: GateResult[],
  verdict: Verdict,
): DiagnosisResult {
  const notChecked: NotChecked[] = ["extension-page-console", "cors"];
  return {
    packId: "logs-and-errors",
    cardPageId: LOGS_CARD,
    verifiedOn: VERIFIED_ON,
    subject: { kind: "logs", matched: [] },
    gates,
    verdict,
    confidence: verdict.status === "no_data" ? "unknown" : "likely",
    files: [],
    notChecked: evidence.connection.ok ? notChecked : [],
  };
}

/** Runs the pack on the logs, calls and console the loader read. */
export function diagnoseLogsAndErrors(
  evidence: LogEvidence,
  about404 = false,
): DiagnosisResult {
  if (!evidence.connection.ok) {
    const { message, failure } = evidence.connection;
    const data = gate(
      "data",
      "fail",
      "LOG-00",
      "clientUnreachable",
      `Could not reach the Apty Client: ${message}`,
      { message, failure },
    );
    return finish(evidence, [data], {
      status: "no_data",
      headline: data.detail,
      causes: [],
      nextCheck: "fixConnection",
    });
  }

  const gates: GateResult[] = [];
  const causes: Cause[] = [];
  const nexts: NextCheck[] = [];

  if (evidence.clientLogs.ok) {
    const found = knownIn(evidence.clientLogs.lines, "Apty Client logs");
    causes.push(...found);
    gates.push(
      sourceGate(
        "client-logs",
        "Apty Client logs",
        evidence.clientLogs.lines,
        found,
      ),
    );
  } else {
    gates.push(
      gate(
        "client-logs",
        "unknown",
        "LOG-00",
        "logsUnavailable",
        `The Apty Client's logs could not be read: ${evidence.clientLogs.message}`,
        {
          message: evidence.clientLogs.message,
          failure: evidence.clientLogs.failure,
        },
      ),
    );
  }

  const calls = callsStep(evidence, about404);
  gates.push(...calls.gates);
  causes.push(...calls.causes);

  const page = evidence.page;
  if (page?.ok) {
    const found = knownIn(page.lines, "page console");
    causes.push(...found);
    gates.push(sourceGate("page-console", "page console", page.lines, found));
    const contentHosts = new Set(evidence.calls.map((c) => c.host));
    const pageFindings = pageStep(page.lines, contentHosts);
    gates.push(...pageFindings.gates);
    causes.push(...pageFindings.causes);
    if (pageFindings.gates.some((g) => g.reason === "cspBlockedOther")) {
      nexts.push("readConsoleText");
    }
  } else {
    gates.push(
      gate(
        "page-console",
        "unknown",
        "LOG-00",
        page ? "pageConsoleUnavailable" : "noPageConsole",
        page
          ? `The page's console could not be read: ${page.message}`
          : "No web page is open in this tab, so its console was not read.",
        page ? { message: page.message, failure: page.code } : {},
      ),
    );
    nexts.push("openAppPage");
  }
  if (gates.some((g) => g.reason === "no404FromApty"))
    nexts.unshift("removalTest");

  const open = gates.some((g) => g.status === "unknown");
  const verdict: Verdict =
    causes.length > 0
      ? {
          status: "cause_found",
          headline: causes[0]?.summary ?? "",
          causes,
          ...(open ? { nextCheck: "openItems" as const } : {}),
        }
      : open
        ? {
            status: "candidates",
            headline:
              "No message the KB cards name, and no failed Apty request, in what could be read.",
            causes: [],
            nextCheck: nexts[0] ?? "openItems",
          }
        : {
            status: "no_cause_in_data",
            headline:
              "No message the KB cards name, and no failed Apty request, in the logs, the calls or the page's console.",
            causes: [],
            nextCheck: "sendSupport",
          };
  return finish(evidence, gates, verdict);
}
