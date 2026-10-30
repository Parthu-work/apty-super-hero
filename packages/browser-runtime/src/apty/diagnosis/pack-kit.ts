/**
 * What every check pack shares: reading the loader's files, naming a file
 * that could not be read, telling a 4.x tenant from a 5.x one, and building
 * a gate result.
 */
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

const FOUR_X_FILES = ["flow.json", "segments.json", "rules.json"];
const FIVE_X_FILES = ["workflow.json", "segment.json", "rule.json"];

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

export function looks4x(evidence: ClientEvidence): boolean {
  const names = new Set(evidence.observedNames);
  return (
    FOUR_X_FILES.some((n) => names.has(n)) &&
    !FIVE_X_FILES.some((n) => names.has(n))
  );
}
