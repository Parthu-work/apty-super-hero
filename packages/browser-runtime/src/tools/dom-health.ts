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
import { tool } from "@apty/agent-core";
import { z } from "zod";
import {
  recordToolCall,
  runApplicationDomHealthAudit,
  runDomHealthAudit,
} from "../apty/index.js";
import { resolveDiagnosticTab, type ToolRunContext } from "./tab-utils";

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
    const tab = await resolveDiagnosticTab(context as ToolRunContext);
    if (!tab.id) {
      return { available: false, error: "No active tab found." };
    }
    return runDomHealthAudit(tab.id);
  },
});

export const runApplicationDomHealthAuditTool = tool({
  name: "run_application_dom_health_audit",
  description:
    "Run an application-wide Apty DOM Readiness audit starting from the current tab's page: discovers other same-origin pages via real <a href> links already in the DOM (never by clicking anything), navigates to each safe one in turn, audits every page with the same deterministic pipeline as run_dom_health_audit, and aggregates an element-weighted application score (never a blind average of per-page scores). " +
    "Returns an explicit page inventory (audited/failed/skipped-unsafe/skipped-cross-origin/skipped-duplicate) and a coverage percentage — the result's `scope` is only ever 'application' when 2+ pages were actually audited; a single-page result reports scope 'page' even though this tool was called. " +
    "This can take up to a few minutes and will navigate the user's active tab away from its current page through several pages — only call this when the user clearly wants application-wide/multi-page coverage, not for a single-page check (use run_dom_health_audit for that). " +
    "Never clicks buttons, submits forms, or executes page JavaScript — discovery is read-only link inspection, and destructive-looking links (delete/logout/submit/pay/...) are always skipped. " +
    "The score, coverage, risks, and recommendations are calculated by code, not by you — report them exactly as returned.",
  parameters: z.object({
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Maximum number of pages to audit (default 15)."),
  }),
  execute: async (input, context) => {
    recordToolCall(
      (context as ToolRunContext)?.context?.conversationId,
      "run_application_dom_health_audit",
      input,
    );
    const tab = await resolveDiagnosticTab(context as ToolRunContext);
    if (!tab.id) {
      return { available: false, error: "No active tab found." };
    }
    return runApplicationDomHealthAudit(tab.id, {
      maxPages: input.maxPages,
    });
  },
});

export const domHealthTools = [
  runDomHealthAuditTool,
  runApplicationDomHealthAuditTool,
];
