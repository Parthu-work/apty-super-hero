/**
 * What every check pack shares: reading the loader's files, naming a file
 * that could not be read, telling a 4.x tenant from a 5.x one, and building
 * a gate result.
 */
import { redactText } from "../../runtime/redaction-mode.js";
import type {
  ClientEvidence,
  FileStatus,
  GateId,
  GateReason,
  GateResult,
  GateStatus,
  LoadedFile,
  NextCheck,
  Params,
  RuleId,
} from "./types.js";

export type Rec = Record<string, unknown>;

const URL_IN_TEXT = /\bhttps?:\/\/[^\s)"']+/g;
const MAX_ERROR_CHARS = 160;

/**
 * A failed call's error text as a card or a transcript may quote it:
 * redacted in the current mode, with no URL, a few words at most.
 */
export function quotedErrorText(text: string): string {
  const shown = redactText(text).replace(URL_IN_TEXT, "[url]");
  return shown.length > MAX_ERROR_CHARS
    ? `${shown.slice(0, MAX_ERROR_CHARS)}…`
    : shown;
}

export const records = (value: unknown): Rec[] =>
  Array.isArray(value)
    ? value.filter((x): x is Rec => typeof x === "object" && x !== null)
    : [];

export const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

export const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((x) =>
        typeof x === "string"
          ? [x]
          : typeof x === "object" && x !== null && text((x as Rec).id)
            ? [(x as Rec).id as string]
            : [],
      )
    : [];

export const short = (id: string) => id.slice(0, 8);

/** The names an item shows, from its own `name` and each locale's `name`. */
export function namesOf(item: Rec): string[] {
  const own = text(item.name);
  const localized = records(item.locales).flatMap((l) => {
    const name = text(l.name);
    return name ? [name] : [];
  });
  return [...new Set([...(own ? [own] : []), ...localized])];
}

export const labelOf = (item: Rec) => namesOf(item)[0] ?? "(unnamed)";

/** The items a name or sourceId names: by id, then by exact name, then by a name that contains it. */
export function resolveItems(items: Rec[], query: string): Rec[] {
  const wanted = query.trim().toLowerCase();
  const byId = items.filter(
    (i) => text(i.sourceId) === query.trim() || text(i.id) === query.trim(),
  );
  if (byId.length > 0) return byId;
  const exact = items.filter((i) =>
    namesOf(i).some((n) => n.trim().toLowerCase() === wanted),
  );
  if (exact.length > 0) return exact;
  return items.filter((i) =>
    namesOf(i).some((n) => n.toLowerCase().includes(wanted)),
  );
}

export function fileOf(evidence: ClientEvidence, name: string): LoadedFile {
  return evidence.files[name] ?? { name, status: "not_observed" };
}

export function jsonOf(evidence: ClientEvidence, name: string): unknown {
  const file = fileOf(evidence, name);
  return file.status === "ok" ? file.json : undefined;
}

export function makeGate(
  cardPageId: string,
  id: GateId,
  status: GateStatus,
  ruleId: RuleId,
  reason: GateReason,
  detail: string,
  params: Params = {},
  evidence: string[] = [],
): GateResult {
  return { id, status, ruleId, reason, params, detail, evidence, cardPageId };
}

export const FILE_PROBLEMS: Record<
  Exclude<FileStatus, "ok">,
  { reason: GateReason; nextCheck: NextCheck; text: (f: LoadedFile) => string }
> = {
  not_observed: {
    reason: "notObserved",
    nextCheck: "reload",
    text: (f) => `The Apty Client did not report loading ${f.name}.`,
  },
  empty: {
    reason: "emptyList",
    nextCheck: "readStatus",
    text: (f) =>
      `${f.name} loaded (HTTP ${f.httpStatus}) but is an empty list.`,
  },
  http_error: {
    reason: "httpError",
    nextCheck: "fixRequest",
    text: (f) => `${f.name} failed to load (HTTP ${f.httpStatus}).`,
  },
  failed: {
    reason: "requestFailed",
    nextCheck: "fixRequest",
    text: (f) =>
      `The request for ${f.name} failed${f.detail ? ` (${f.detail})` : ""}.`,
  },
  pending: {
    reason: "pending",
    nextCheck: "waitForLoad",
    text: (f) => `${f.name} was still loading.`,
  },
  body_denied: {
    reason: "denied",
    nextCheck: "denyList",
    text: (f) =>
      `${f.name} matches the body deny list entry "${f.detail}", so it was not read.`,
  },
  body_unavailable: {
    reason: "bodyUnavailable",
    nextCheck: "bodyLimit",
    text: (f) =>
      `The Apty Client has no body for ${f.name}${f.detail ? ` (${f.detail})` : ""}.`,
  },
  too_large_to_redact: {
    reason: "bodyUnavailable",
    nextCheck: "bodyLimit",
    text: (f) => `${f.name} is too large to redact, so it was not read.`,
  },
  unparsable: {
    reason: "unparsable",
    nextCheck: "openResponse",
    text: (f) => `${f.name} is not valid JSON.`,
  },
};

export function fileParams(file: LoadedFile): Params {
  return {
    file: file.name,
    ...(file.httpStatus !== undefined ? { httpStatus: file.httpStatus } : {}),
    ...(file.detail ? { detail: file.detail } : {}),
  };
}

/**
 * The files only one player reads. Both players read `app-urls.json` and
 * `app-data.json` (apty-assist `player3.0/src/shared/helpers/cdn-helpers.ts`
 * lines 17 and 23; apty-dap's player CDN service, `cdn.service.ts`), so
 * they tell nothing. The 5.x player reads `workflow.json`, `segment.json`
 * and `rule.json` and a `workflow-<uuid>.json` per workflow; the 4.x player
 * reads `flow.json`, `segments.json`, `rules.json`, `feature-flag.json`
 * (`feature-flag.effects.ts`) and a `flow-<id>.json` per flow
 * (`cdn-helpers.ts`). `config.json` is read by the 4.x Studio from its own
 * extension, never in a tenant's calls, so it is not a marker.
 */
const FIVE_X_MARKERS = new Set(["workflow.json", "segment.json", "rule.json"]);
const FOUR_X_MARKERS = new Set([
  "flow.json",
  "segments.json",
  "rules.json",
  "feature-flag.json",
]);
const FOUR_X_FLOW_FILE = /^flow-[\w-]+\.json$/;

const isFiveX = (name: string) => FIVE_X_MARKERS.has(name);
const isFourX = (name: string) =>
  FOUR_X_MARKERS.has(name) || FOUR_X_FLOW_FILE.test(name);

/**
 * Which player the files are from, when they tell: `unknown` when only
 * shared files, or files of both players, were observed. It decides whether
 * the regex URL flags can be on at all: the 5.x player's `getFeatureFlags()`
 * only ever returns `DEFAULT_FEATURE_FLAGS`, where `urlRegex` and
 * `regExpUrl` are off, and nothing fetches a tenant's values (apty-dap
 * `cdn-api/src/types/feature-flags.ts` and `player/.../cdn/cdn.service.ts:933`,
 * Appendix A1 and A2 of the Ask Dapty brief); the 4.x player fetches them
 * per tenant (apty-assist `feature-flag.effects.ts`, A4). Files read from
 * the content CDN are always 5.x: only the 5.x Client is found that way.
 */
export function playerVersionOf(
  evidence: ClientEvidence,
): "5.x" | "4.x" | "unknown" {
  if (evidence.fromCdn) return "5.x";
  const five = evidence.observedNames.some(isFiveX);
  const four = evidence.observedNames.some(isFourX);
  if (five === four) return "unknown";
  return five ? "5.x" : "4.x";
}

export function looks4x(evidence: ClientEvidence): boolean {
  return playerVersionOf(evidence) === "4.x";
}
