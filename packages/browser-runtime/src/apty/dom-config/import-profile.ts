/**
 * Turns pasted or loaded console-script output into runs the engine can
 * analyze. Truncated or malformed text is rejected with what is wrong and
 * how to capture it again (D8). Errors never repeat any of the input: a
 * JSON parser's own message quotes the text around the fault, which can be
 * patient data, so it is never passed on.
 */
import { detectNoisePresence, flattenRun } from "./flatten.js";
import { DOM_CONFIG_LIMITS } from "./limits.js";
import { type NoisePolicy, noisePolicy } from "./noise.js";
import { toUrlShape } from "./text.js";
import type {
  DomProfileNode,
  DomProfileV2,
  PageCapture,
  ProfileRun,
  RunLabel,
} from "./types.js";

export type ProfileImportErrorCode =
  | "empty"
  | "too-large"
  | "truncated"
  | "invalid-json"
  | "not-a-profile"
  | "missing-sections"
  | "malformed";

export interface ProfileImportError {
  code: ProfileImportErrorCode;
  message: string;
  missing: string[];
  instructions: string;
}

/** Sections the console script writes only once the page has something to put in them. */
type OptionalSection = "maxZIndex" | "shadowRoots" | "iframes";

export type ProfileImportResult =
  | {
      ok: true;
      profile: DomProfileV2;
      absentSections: OptionalSection[];
      aptyPresent: boolean;
      extensionNoisePresent: boolean;
    }
  | { ok: false; error: ProfileImportError };

const RECAPTURE =
  "Run the DOM analysis script again on the same page. It copies the whole result to the clipboard; paste from the clipboard (or save it with a text editor) rather than copying the text the console prints, which the console can cut short.";

function failure(
  code: ProfileImportErrorCode,
  message: string,
  missing: string[] = [],
): ProfileImportResult {
  return {
    ok: false,
    error: { code, message, missing, instructions: RECAPTURE },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** The first section of `node` (or a node nested in it) that does not have the script's shape, or null. */
function malformedSection(
  node: Record<string, unknown>,
  depth: number,
): string | null {
  if (depth > DOM_CONFIG_LIMITS.maxNestingDepth) return "nesting";
  if (node.tags !== undefined) {
    if (!isRecord(node.tags) || !Object.values(node.tags).every(isCount)) {
      return "tags";
    }
  }
  if (node.attributes !== undefined) {
    if (
      !isRecord(node.attributes) ||
      !Object.values(node.attributes).every(
        (values) => isRecord(values) && Object.values(values).every(isCount),
      )
    ) {
      return "attributes";
    }
  }
  if (node.maxZIndex !== undefined && typeof node.maxZIndex !== "number") {
    return "maxZIndex";
  }
  for (const key of ["shadowRoots", "iframes"] as const) {
    const children = node[key];
    if (children === undefined) continue;
    if (!isRecord(children)) return key;
    for (const child of Object.values(children)) {
      if (!isRecord(child)) return key;
      if (
        key === "iframes" &&
        child.isCrossOrigin !== undefined &&
        typeof child.isCrossOrigin !== "boolean"
      ) {
        return key;
      }
      const nested = malformedSection(child, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

const V2_ARRAYS = ["zIndexSources", "frames", "shadow", "elementFingerprints"];

/** Parse one profile. `ignoredRoots` are the Settings → Troubleshooting entries, used to recognise noise. */
export function parseDomProfile(
  text: string,
  ignoredRoots: readonly string[] = [],
): ProfileImportResult {
  if (text.length > DOM_CONFIG_LIMITS.maxInputChars) {
    return failure(
      "too-large",
      `The profile is ${text.length} characters, more than the ${DOM_CONFIG_LIMITS.maxInputChars} one profile may have.`,
    );
  }
  const trimmed = text.trim();
  if (!trimmed) return failure("empty", "The profile is empty.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return trimmed.startsWith("{") && !trimmed.endsWith("}")
      ? failure(
          "truncated",
          `The JSON stops before it is complete (${trimmed.length} characters, no closing brace). The console most likely cut it short.`,
        )
      : failure("invalid-json", "The text is not valid JSON.");
  }
  if (!isRecord(parsed)) {
    return failure("not-a-profile", "The JSON is not a DOM analysis profile.");
  }
  const missing = ["tags", "attributes"].filter(
    (key) => !isRecord(parsed[key]),
  );
  if (missing.length > 0) {
    return failure(
      "missing-sections",
      `The profile has no ${missing.join(" or ")} section, which every page produces.`,
      missing,
    );
  }
  const malformed = malformedSection(parsed, 0);
  if (malformed) {
    return failure(
      "malformed",
      `The ${malformed} section does not have the shape the DOM analysis script writes.`,
    );
  }
  if (parsed.schema === 2) {
    const bad = V2_ARRAYS.find(
      (key) => parsed[key] !== undefined && !Array.isArray(parsed[key]),
    );
    if (bad) {
      return failure(
        "malformed",
        `The ${bad} section does not have the shape the extension's collector writes.`,
      );
    }
  }
  const profile = parsed as unknown as DomProfileV2;
  const absentSections = (
    ["maxZIndex", "shadowRoots", "iframes"] as const
  ).filter((key) => (parsed as DomProfileNode)[key] === undefined);
  const presence = profileNoisePresence(profile, noisePolicy(ignoredRoots));
  return { ok: true, profile, absentSections, ...presence };
}

function profileNoisePresence(profile: DomProfileV2, policy: NoisePolicy) {
  const flat = flattenRun(
    {
      profile,
      meta: {
        label: "initial",
        aptyPresent: false,
        extensionNoisePresent: false,
      },
    },
    policy,
  );
  return detectNoisePresence(flat, policy);
}

export interface ImportedRunInput {
  text: string;
  label: RunLabel;
  capturedAt?: string;
  url?: string;
}

export interface PageImportInput {
  pageId: string;
  label: string;
  runs: ImportedRunInput[];
}

export interface PageImportResult {
  page: PageCapture | null;
  errors: Array<{ run: number; error: ProfileImportError }>;
}

/** Several labeled profiles of one page as a `PageCapture`; runs that fail to parse are reported by position and left out. */
export function buildPageCapture(
  input: PageImportInput,
  ignoredRoots: readonly string[] = [],
): PageImportResult {
  const runs: ProfileRun[] = [];
  const errors: PageImportResult["errors"] = [];
  input.runs.forEach((run, index) => {
    const result = parseDomProfile(run.text, ignoredRoots);
    if (!result.ok) {
      errors.push({ run: index, error: result.error });
      return;
    }
    runs.push({
      profile: result.profile,
      meta: {
        label: run.label,
        ...(run.capturedAt ? { capturedAt: run.capturedAt } : {}),
        ...(run.url ? { urlShape: toUrlShape(run.url) } : {}),
        aptyPresent: result.aptyPresent,
        extensionNoisePresent: result.extensionNoisePresent,
      },
    });
  });
  return {
    page: runs.length
      ? { pageId: input.pageId, label: input.label, runs }
      : null,
    errors,
  };
}
