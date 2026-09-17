/**
 * Application-wide DOM Health audit orchestrator (spec sections 2-6, 23-25).
 *
 * Discovers same-origin pages via real `<a href>` elements already in the
 * DOM (see `@aipexstudio/dom-snapshot`'s `health-links.ts` — never a
 * simulated click), navigates the tab to each one in turn, waits for a
 * real load-complete signal plus a DOM-quiet-period signal (never a fixed
 * sleep), runs the exact same per-page audit pipeline `runDomHealthAudit`
 * already uses, and aggregates the result with `application-scoring.ts` —
 * element-weighted across pages, never a blind average.
 *
 * Hard limits (`maxPages`/`maxTotalAuditMs`/`maxQueueSize`) bound the whole
 * run; every page attempted — audited, failed, or skipped — is recorded in
 * the returned inventory, so coverage is always explicit (spec section 4).
 *
 * Never executes anything beyond reading hrefs and navigating: it does not
 * click buttons, submit forms, or run arbitrary page JavaScript, and a
 * conservative same-origin + destructive-keyword filter (`isSafeToDiscover`)
 * is re-checked here even though the content script already applied it —
 * defense in depth, not because either check alone is trusted blindly.
 */
import { isSafeToDiscover } from "@aipexstudio/dom-snapshot";
import {
  type ApplicationAuditResult,
  buildApplicationAuditResult,
  type PageAuditRecord,
} from "./application-scoring.js";
import { isUnsupportedPage, runDomHealthAudit } from "./dom-health.js";
import {
  collectPageLinks,
  getNavigationModel,
  navigateTab,
  waitForDomStable,
} from "./page-navigation.js";

export interface ApplicationAuditLimits {
  /** Maximum number of pages actually audited in one run. Defaults to 15. */
  maxPages?: number;
  /** Wall-clock ceiling for the whole run, regardless of page count. Defaults to 3 minutes. */
  maxTotalAuditMs?: number;
  /** Maximum number of pages ever queued for discovery (bounds runaway link discovery). Defaults to 100. */
  maxQueueSize?: number;
  /** Maximum number of "skipped" inventory rows recorded for unsafe/cross-origin links, so one page full of disallowed links can't flood the report. Defaults to 50. */
  maxSkipRows?: number;
}

const DEFAULT_LIMITS: Required<ApplicationAuditLimits> = {
  maxPages: 15,
  maxTotalAuditMs: 180_000,
  maxQueueSize: 100,
  maxSkipRows: 50,
};

export type ApplicationAuditProgress =
  | { phase: "auditing"; url: string; pageIndex: number; pagesQueued: number }
  | { phase: "discovering-links"; url: string };

export interface RunApplicationAuditOptions extends ApplicationAuditLimits {
  onProgress?: (progress: ApplicationAuditProgress) => void;
}

export type ApplicationAuditOutcome =
  | ({ available: true } & ApplicationAuditResult)
  | { available: false; error: string };

let auditSequence = 0;
function generateAuditId(): string {
  auditSequence += 1;
  return `app-dom-health-${Date.now()}-${auditSequence}`;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

interface QueueItem {
  url: string;
  source: "seed" | "same-origin-link";
}

/**
 * Run a full application-wide DOM Health audit starting from the given
 * tab's current page. Safe by construction: only real `<a href>` targets
 * that pass the same-origin + non-destructive-keyword filter are ever
 * navigated to; hard limits bound total pages, queue size, and wall-clock
 * time.
 */
export async function runApplicationDomHealthAudit(
  tabId: number,
  options: RunApplicationAuditOptions = {},
): Promise<ApplicationAuditOutcome> {
  const limits: Required<ApplicationAuditLimits> = {
    ...DEFAULT_LIMITS,
    ...options,
  };
  const startedAt = Date.now();

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return {
      available: false,
      error: "The target tab could not be found — it may have been closed.",
    };
  }

  const seedUrl = tab.url;
  if (isUnsupportedPage(seedUrl)) {
    return {
      available: false,
      error:
        "This page does not allow DOM inspection (browser and extension internal pages are not accessible to content scripts).",
    };
  }

  const visited = new Set<string>();
  const queuedUrls = new Set<string>();
  const skippedUrls = new Set<string>();
  const queue: QueueItem[] = [{ url: seedUrl!, source: "seed" }];
  queuedUrls.add(normalizeUrl(seedUrl!));
  const pages: PageAuditRecord[] = [];
  let isFirstPage = true;
  let auditedCount = 0;

  while (
    queue.length > 0 &&
    auditedCount < limits.maxPages &&
    Date.now() - startedAt < limits.maxTotalAuditMs
  ) {
    const next = queue.shift()!;
    const normalized = normalizeUrl(next.url);
    queuedUrls.delete(normalized);
    if (visited.has(normalized)) {
      pages.push({
        url: next.url,
        title: null,
        discoverySource: next.source,
        status: "skipped-duplicate",
      });
      continue;
    }
    visited.add(normalized);

    options.onProgress?.({
      phase: "auditing",
      url: next.url,
      pageIndex: pages.length,
      pagesQueued: queue.length,
    });

    if (!isFirstPage) {
      try {
        await navigateTab(tabId, next.url);
      } catch (error) {
        pages.push({
          url: next.url,
          title: null,
          discoverySource: next.source,
          status: "failed",
          failureReason:
            error instanceof Error ? error.message : "Navigation failed",
        });
        continue;
      }
    }
    isFirstPage = false;

    await waitForDomStable(tabId);

    const auditOutcome = await runDomHealthAudit(tabId);
    if (!auditOutcome.available) {
      pages.push({
        url: next.url,
        title: null,
        discoverySource: next.source,
        status: "failed",
        failureReason: auditOutcome.error,
      });
      continue;
    }

    auditedCount++;
    pages.push({
      url: auditOutcome.url,
      title: auditOutcome.pageTitle,
      discoverySource: next.source,
      status: "completed",
      result: auditOutcome,
    });

    if (auditedCount >= limits.maxPages) break;
    if (Date.now() - startedAt >= limits.maxTotalAuditMs) break;

    options.onProgress?.({ phase: "discovering-links", url: next.url });

    // Best-effort, non-fatal: if link discovery fails for any reason, the
    // audit still returns everything gathered so far rather than aborting.
    const navigationModel = await getNavigationModel(tabId).catch(() => null);
    if (navigationModel) {
      const lastPage = pages[pages.length - 1];
      if (lastPage) lastPage.navigationModel = navigationModel;
    }

    const links = await collectPageLinks(tabId).catch(() => []);
    for (const link of links) {
      if (queue.length >= limits.maxQueueSize) break;
      const normalizedLink = normalizeUrl(link.absoluteUrl);
      if (visited.has(normalizedLink) || queuedUrls.has(normalizedLink)) {
        continue;
      }
      if (!isSafeToDiscover(link)) {
        if (
          !skippedUrls.has(normalizedLink) &&
          skippedUrls.size < limits.maxSkipRows
        ) {
          skippedUrls.add(normalizedLink);
          pages.push({
            url: link.absoluteUrl,
            title: null,
            discoverySource: "same-origin-link",
            status: link.sameOrigin ? "skipped-unsafe" : "skipped-cross-origin",
          });
        }
        continue;
      }
      queue.push({ url: link.absoluteUrl, source: "same-origin-link" });
      queuedUrls.add(normalizedLink);
    }
  }

  const result = buildApplicationAuditResult(pages, generateAuditId());
  return { available: true, ...result };
}
