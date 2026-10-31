/**
 * The HAR file check of the side panel: an SE who has a customer's HAR
 * instead of a connected Apty Client runs the same visibility and widget
 * checks on it. The file is read in memory only; its Apty files go through
 * the deny list and redaction like the Client's (`evidenceFromHar`), only
 * files under Apty's tenant paths count, and the summary names files and
 * counts, never a URL.
 */
import { resourceNameFor } from "../resource-body-utils.js";
import { diagnoseContentNotVisible, filesFor } from "./content-not-visible.js";
import { evidenceFromHar, isAptyContentUrl, pageUrlOfHar } from "./har.js";
import { environmentsIn } from "./loader.js";
import { type Rec, records } from "./pack-kit.js";
import { type ContentKind, type DiagnosisResult, KINDS } from "./types.js";
import {
  diagnoseWidgetNotVisible,
  WIDGET_FILES,
} from "./widget-not-visible.js";

/** Larger than any capture seen (3.8 MB), small enough to parse in the panel. */
const MAX_HAR_CHARS = 50_000_000;
/** The same limit on the file's size, checked before it is read into memory. */
export const MAX_HAR_BYTES = MAX_HAR_CHARS;

const FILES_5X = new Set([
  ...Object.values(KINDS).map((k) => k.file),
  ...WIDGET_FILES,
]);
const FILES_4X = new Set(["flow.json", "segments.json", "rules.json"]);
const STEPS_FILE = /^workflow-[\w-]+\.json$/;

export type HarRead =
  | { ok: true; har: unknown }
  | { ok: false; reason: "too-large" | "not-json" | "not-har" };

export function readHar(text: string, maxChars = MAX_HAR_CHARS): HarRead {
  if (text.length > maxChars) return { ok: false, reason: "too-large" };
  let har: unknown;
  try {
    har = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  const log = (har as { log?: { entries?: unknown } } | null)?.log;
  return Array.isArray(log?.entries)
    ? { ok: true, har }
    : { ok: false, reason: "not-har" };
}

export interface HarSummary {
  calls: number;
  /** The Apty content files the HAR holds a body for, by name. */
  contentFiles: string[];
  /** Calls for an Apty content file that brought none: failed, or recorded without a body. */
  callsWithoutFile: number;
  /** The Apty environments the content calls came from; a check reads the newest one's files. */
  environments: number;
  version: "5.x" | "4.x" | "none";
  /** A document request is there, so the widget check can match environments. */
  hasPage: boolean;
}

const isContentFile = (name: string) =>
  FILES_5X.has(name) || FILES_4X.has(name) || STEPS_FILE.test(name);

export function summarizeHar(har: unknown): HarSummary {
  const entries = records((har as { log?: Rec }).log?.entries);
  const aptyCalls = entries.flatMap((entry) => {
    const url = (entry.request as Rec | undefined)?.url;
    if (typeof url !== "string" || !isAptyContentUrl(url)) return [];
    const name = resourceNameFor(url);
    if (!isContentFile(name)) return [];
    const content = (entry.response as Rec | undefined)?.content as
      | Rec
      | undefined;
    return [{ url, name, hasFile: typeof content?.text === "string" }];
  });
  const names = aptyCalls.filter((c) => c.hasFile).map((c) => c.name);
  const contentFiles = [...new Set(names)].sort();
  const has5x = contentFiles.some((n) => FILES_5X.has(n));
  return {
    calls: entries.length,
    contentFiles,
    callsWithoutFile: aptyCalls.filter((c) => !c.hasFile).length,
    environments: environmentsIn(aptyCalls.map((c) => c.url)),
    version: has5x
      ? "5.x"
      : contentFiles.some((n) => FILES_4X.has(n))
        ? "4.x"
        : "none",
    hasPage: pageUrlOfHar(har) !== undefined,
  };
}

export type HarCheck =
  | { packId: "content-not-visible"; kind: ContentKind; query?: string }
  | { packId: "widget-not-visible" };

/** Runs a visibility or widget check on a HAR, the page it was recorded on standing in for the tab. */
export async function runHarCheck(
  har: unknown,
  check: HarCheck,
): Promise<DiagnosisResult> {
  if (check.packId === "widget-not-visible") {
    return diagnoseWidgetNotVisible(
      await evidenceFromHar(har, WIDGET_FILES),
      pageUrlOfHar(har),
    );
  }
  return diagnoseContentNotVisible(
    await evidenceFromHar(har, filesFor(check.kind)),
    check.kind,
    check.query,
  );
}
