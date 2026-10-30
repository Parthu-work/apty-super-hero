/**
 * A HAR file as a source of the Client's calls, for tests on real captures
 * and for a later support path where an SE attaches a HAR instead of
 * connecting the Client. Its bodies go through the same deny list and
 * redaction as the Client's, so a HAR's content is read exactly as the
 * Client's would be. Nothing here is sent anywhere.
 */
import type { AptyObservedResource } from "../types.js";
import { loadEvidenceFrom, type ResourceSource } from "./loader.js";
import type { ClientEvidence } from "./types.js";

type Rec = Record<string, unknown>;

interface HarCall {
  resource: AptyObservedResource;
  text?: string;
  base64: boolean;
}

const rec = (value: unknown): Rec =>
  typeof value === "object" && value !== null ? (value as Rec) : {};

function entriesOf(har: unknown): Rec[] {
  const entries = rec(rec(har).log).entries;
  return Array.isArray(entries) ? entries.map(rec) : [];
}

function callsOf(har: unknown): HarCall[] {
  return entriesOf(har).flatMap((entry, index): HarCall[] => {
    const request = rec(entry.request);
    const response = rec(entry.response);
    const content = rec(response.content);
    if (typeof request.url !== "string") return [];
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
        },
        text,
        base64: content.encoding === "base64",
      },
    ];
  });
}

/** The calls of a HAR file, served the way the Client serves its own. */
function harSource(har: unknown): ResourceSource {
  const calls = callsOf(har);
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

/** The page the HAR was recorded on: its first document request, if any. */
export function pageUrlOfHar(har: unknown): string | undefined {
  const page = entriesOf(har).find(
    (e) =>
      e._resourceType === "document" ||
      String(rec(rec(e.response).content).mimeType).startsWith("text/html"),
  );
  const url = rec(page?.request).url;
  return typeof url === "string" ? url : undefined;
}
