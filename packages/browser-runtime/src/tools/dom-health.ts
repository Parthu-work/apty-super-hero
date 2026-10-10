/**
 * Apty DOM Health / DOM Readiness tool.
 *
 * Thin wrapper around `../apty/dom-health.js`'s `runDomHealthAudit` — the
 * exact same function the side panel's "Check DOM Health" button calls
 * directly (no agent turn involved). Exposing it as a tool too lets the
 * agent run (or explain) the same deterministic audit when asked in chat,
 * e.g. "check DOM health" or "why is the readiness score low" — it must
 * never invent a different score, only report what this tool returns.
 */
import { type AppSettings, STORAGE_KEYS, tool } from "@apty/agent-core";
import { z } from "zod";
import { REDACTED_TITLE } from "../apty/dom-health-redaction.js";
import {
  recordToolCall,
  runApplicationDomHealthAudit,
  runDomHealthAudit,
} from "../apty/index.js";
import { ChromeStorageAdapter } from "../storage/storage-adapter.js";
import {
  describeTabForMeta,
  describeTabResolutionFailure,
  resolveDiagnosticTab,
  type ToolRunContext,
} from "./tab-utils";

/** The tab as the model may see it: the audit result is already redacted, and the tab title carries the same page context as `pageTitle`. */
function describeTabForReport(tab: chrome.tabs.Tab) {
  return {
    ...describeTabForMeta(tab),
    title: tab.title ? REDACTED_TITLE : null,
  };
}

const settingsStorage = new ChromeStorageAdapter<AppSettings>();

/** Settings → Troubleshooting: overlays the user added to DOM Health's built-in exclusion list. */
async function userIgnoredRoots(): Promise<string[]> {
  const settings = await settingsStorage
    .load(STORAGE_KEYS.SETTINGS)
    .catch(() => null);
  return settings?.domHealthIgnoredRoots ?? [];
}

export const runDomHealthAuditTool = tool({
  name: "run_dom_health_audit",
  description:
    "Run an explicit Apty DOM Readiness audit of the CURRENT PAGE ONLY in the current tab: takes three DOM snapshots over a few seconds, simulates Apty-style element-selection (candidate generation, live uniqueness/target-identity verification, ignore/partial/contextual recovery, cross-snapshot stability, 9-point hit testing), and returns a deterministic 0-100 Apty DOM Readiness Score with a confidence level, manual-selector-dependency estimate, evidence-backed risks, and recommendations. " +
    "This score is calculated by code, not by you — always report the score, confidence, metrics, risks, and recommendations exactly as returned; never calculate your own score or invent metrics/evidence that aren't in the result. " +
    "Use this when asked to check DOM health/readiness for the page the user is currently on, or to explain why a readiness score is low — call it again to get a fresh, current result rather than guessing. " +
    "For 'the whole application'/'across pages' requests, use run_application_dom_health_audit instead — this tool never claims application-wide coverage. " +
    "Independent of Apty Client/Studio/Service-Worker state — it only reads the page's own DOM, so it works even when those integrations are unavailable.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    recordToolCall(
      (context as ToolRunContext)?.context?.conversationId,
      "run_dom_health_audit",
      {},
    );
    const resolution = await resolveDiagnosticTab(context as ToolRunContext);
    if (!resolution.ok) {
      return {
        available: false,
        status: describeTabResolutionFailure(resolution.code),
      };
    }
    const tab = resolution.tab;
    const result = await runDomHealthAudit(tab.id as number, {
      ignoredRoots: await userIgnoredRoots(),
    });
    return { ...result, meta: { tab: describeTabForReport(tab) } };
  },
});

export const runApplicationDomHealthAuditTool = tool({
  name: "run_application_dom_health_audit",
  description:
    "Run an application-wide Apty DOM Readiness audit starting from the current tab's page, with an EXPLICIT discoveryMode you must choose (see that parameter) — it never silently defaults to the deepest/most-invasive option. " +
    "By default ('application-safe'): discovers other same-origin pages via real <a href> links already in the DOM (never by clicking anything), navigates to each safe one in turn, audits every page with the same deterministic pipeline as run_dom_health_audit, and aggregates an element-weighted application score (never a blind average of per-page scores). " +
    "Returns an explicit page/state inventory (audited/failed/skipped-unsafe/skipped-cross-origin/skipped-duplicate/not-discovered) and a coverage percentage — the result's `scope` is only ever 'application' when 2+ states were actually audited; a single-state result reports scope 'page' even though this tool was called. " +
    "The result's `evidenceState` can be `INCOMPLETE_EVIDENCE` even when a numeric score is present — that means real application states/navigation candidates were left unexplored or a backtracking restoration failed, so the score reflects only what was actually covered, never the whole application; always report that distinction, never call a page 'healthy' or the audit 'complete' from evidenceState alone. " +
    "This can take up to a few minutes and will navigate the user's active tab away from its current page through several pages/states — only call this when the user clearly wants application-wide/multi-page coverage, not for a single-page check (use run_dom_health_audit for that). " +
    "Destructive-looking links/controls (delete/logout/submit/pay/...) are always skipped regardless of discoveryMode. " +
    "The score, coverage, risks, and recommendations are calculated by code, not by you — report them exactly as returned.",
  parameters: z.object({
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Maximum number of pages to audit (default 15)."),
    discoveryMode: z
      .enum(["page", "application-safe", "application-deep"])
      .optional()
      .describe(
        "How far this run is allowed to explore beyond the current page/state — never silently defaults to the deepest option. " +
          "'page': audit ONLY the current page/state — no navigation, no clicking, nothing else visited. " +
          "'application-safe' (default): discover other same-origin pages via real <a href> links only, and DETECT (never click) menu/tab/tree-style controls with no real href — reported as not-discovered. " +
          "'application-deep': additionally CLICKS detected safe navigation controls to explore same-URL, menu-driven application states — a real click on the live application; only use this when the user has explicitly asked for deeper same-URL/menu-driven exploration.",
      ),
  }),
  execute: async (input, context) => {
    recordToolCall(
      (context as ToolRunContext)?.context?.conversationId,
      "run_application_dom_health_audit",
      input,
    );
    const resolution = await resolveDiagnosticTab(context as ToolRunContext);
    if (!resolution.ok) {
      return {
        available: false,
        status: describeTabResolutionFailure(resolution.code),
      };
    }
    const tab = resolution.tab;
    const result = await runApplicationDomHealthAudit(tab.id as number, {
      maxPages: input.maxPages,
      discoveryMode: input.discoveryMode,
      ignoredRoots: await userIgnoredRoots(),
    });
    return { ...result, meta: { tab: describeTabForReport(tab) } };
  },
});

export const domHealthTools = [
  runDomHealthAuditTool,
  runApplicationDomHealthAuditTool,
];
