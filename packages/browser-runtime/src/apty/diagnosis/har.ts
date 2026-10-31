/**
 * A HAR file as a source of the Client's calls, for tests on real captures
 * and for a later support path where an SE attaches a HAR instead of
 * connecting the Client. Its bodies go through the same deny list and
 * redaction as the Client's, so a HAR's content is read exactly as the
 * Client's would be. Nothing here is sent anywhere.
 */
import { type DaptyResource, loadDaptyFrom } from "./dapty-loader.js";
import { daptyKindOf } from "./dapty-parse.js";
import type { DaptyEvidence } from "./dapty-types.js";
import { loadEvidenceFrom, type ResourceSource } from "./loader.js";
import type { ClientEvidence } from "./types.js";

type Rec = Record<string, unknown>;

interface HarCall {
  resource: DaptyResource;
  text?: string;
  base64: boolean;
}

const rec = (value: unknown): Rec =>
  typeof value === "object" && value !== null ? (value as Rec) : {};

function entriesOf(har: unknown): Rec[] {
  const entries = rec(rec(har).log).entries;
  return Array.isArray(entries) ? entries.map(rec) : [];
}

/**
 * A HAR holds every call the page made, not only the Client's: a file is
 * Apty content only under a `tenant-<id>` path segment, where both 4.x and
 * 5.x keep theirs, so an `app-data.json` or `segment.json` of another
 * service is never read as the Client's.
 */
export function isAptyContentUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return path.split("/").some((segment) => /^tenant-[\w-]+$/.test(segment));
}

function headerOf(request: Rec, name: string): string | undefined {
  const headers = Array.isArray(request.headers) ? request.headers : [];
  for (const header of headers) {
    const h = rec(header);
    if (String(h.name).toLowerCase() === name && typeof h.value === "string") {
      return h.value;
    }
  }
  return undefined;
}

/** Which of a HAR's calls a reader takes: Apty's content files, or the Ask Dapty chat calls. */
type HarCalls = "content" | "dapty";

function wanted(request: Rec, calls: HarCalls): boolean {
  if (typeof request.url !== "string") return false;
  if (calls === "content") return isAptyContentUrl(request.url);
  const method = typeof request.method === "string" ? request.method : "GET";
  return daptyKindOf(request.url, method) !== undefined;
}

function callsOf(har: unknown, calls: HarCalls = "content"): HarCall[] {
  return entriesOf(har).flatMap((entry, index): HarCall[] => {
    const request = rec(entry.request);
    const response = rec(entry.response);
    const content = rec(response.content);
    if (!wanted(request, calls) || typeof request.url !== "string") {
      return [];
    }
    const postData = rec(request.postData);
    const origin = headerOf(request, "origin");
    const status = typeof response.status === "number" ? response.status : 0;
    const failed = status === 0;
    const text = typeof content.text === "string" ? content.text : undefined;
    const started = Date.parse(String(entry.startedDateTime));
    return [
      {
        resource: {
          requestId: `har-${index}`,
          url: request.url,
          method: typeof request.method === "string" ? request.method : "GET",
          ...(failed
            ? {
                failed: true,
                errorText:
                  typeof response._error === "string"
                    ? response._error
                    : "no response",
              }
            : { status }),
          mimeType:
            typeof content.mimeType === "string" ? content.mimeType : "",
          timestamp: Number.isNaN(started) ? index : started,
          hasBody: text !== undefined,
          ...(calls === "dapty" && typeof postData.text === "string"
            ? { requestBody: postData.text }
            : {}),
          ...(calls === "dapty" && origin ? { origin } : {}),
        },
        text,
        base64: content.encoding === "base64",
      },
    ];
  });
}

/** The calls of a HAR file, served the way the Client serves its own. */
function harSource(har: unknown, which: HarCalls = "content"): ResourceSource {
  const calls = callsOf(har, which);
  return {
    listResources: async () => ({
      ok: true,
      resources: calls.map((c) => c.resource),
    }),
    getResourceBody: async (requestId) => {
      const call = calls.find((c) => c.resource.requestId === requestId);
      return call?.text === undefined
        ? { found: false, reason: "none" }
        : { found: true, body: call.text, base64Encoded: call.base64 };
    },
  };
}

/** The named content files from a HAR file, read as `loadClientEvidence` reads the Client's. */
export function evidenceFromHar(
  har: unknown,
  names: readonly string[],
): Promise<ClientEvidence> {
  return loadEvidenceFrom(harSource(har), names);
}

/** The Ask Dapty chat a HAR recorded: the chat calls with their questions, and any stored chat files. */
export function daptyFromHar(har: unknown): Promise<DaptyEvidence> {
  return loadDaptyFrom(harSource(har, "dapty"), "har");
}

const isDocument = (entry: Rec) =>
  entry._resourceType === "document" ||
  String(rec(rec(entry.response).content).mimeType).startsWith("text/html");

/**
 * The page the HAR's Apty files loaded on: the last document request before
 * its newest Apty content call (entries are in the order they started), or
 * the last document when there is none. A recording that starts on a
 * sign-in page reaches the application's page later.
 */
export function pageUrlOfHar(har: unknown): string | undefined {
  let lastDocument: string | undefined;
  let aptyPage: string | undefined;
  for (const entry of entriesOf(har)) {
    const url = rec(entry.request).url;
    if (typeof url !== "string") continue;
    if (isDocument(entry)) lastDocument = url;
    else if (isAptyContentUrl(url)) aptyPage = lastDocument;
  }
  return aptyPage ?? lastDocument;
}
