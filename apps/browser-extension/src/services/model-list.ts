/**
 * "Fetch models" in Settings: the live model list from the configured
 * provider, so the user picks a model id the provider actually serves.
 * One GET per provider and host (plus pages), cached in memory for ten
 * minutes. The host goes through the same SSRF check as chat requests and
 * the key is only ever sent in the provider's auth header, never logged.
 * On any failure the presets and manual entry stay available.
 */
import type { AppSettings } from "@apty/agent-core";
import { anthropicBaseUrl, validateHostUrl } from "./ai-provider";

export type ModelListKind = "openai-compatible" | "anthropic" | "google";

export type ModelListResult =
  | { ok: true; models: string[]; cached: boolean }
  | { ok: false; error: string; status?: number };

const DEFAULT_BASE: Record<ModelListKind, string> = {
  "openai-compatible": "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
};

export const MODEL_LIST_CACHE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PAGES = 5;

const cache = new Map<string, { at: number; models: string[] }>();

export function clearModelListCache() {
  cache.clear();
}

export function modelListKind(settings: AppSettings): ModelListKind {
  if (settings.aiProvider === "anthropic") return "anthropic";
  if (settings.aiProvider === "google") return "google";
  return "openai-compatible";
}

function baseUrlFor(kind: ModelListKind, aiHost: string | undefined) {
  const validated = validateHostUrl(aiHost || undefined);
  if (kind === "anthropic")
    return anthropicBaseUrl(validated) ?? DEFAULT_BASE.anthropic;
  return validated ?? DEFAULT_BASE[kind];
}

function headersFor(kind: ModelListKind, apiKey: string): HeadersInit {
  if (kind === "anthropic") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  if (kind === "google") return { "x-goog-api-key": apiKey };
  return { Authorization: `Bearer ${apiKey}` };
}

function pageUrl(kind: ModelListKind, base: string, cursor: string | null) {
  const url = new URL(`${base}/models`);
  if (kind === "anthropic") {
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("after_id", cursor);
  } else if (kind === "google") {
    url.searchParams.set("pageSize", "1000");
    if (cursor) url.searchParams.set("pageToken", cursor);
  }
  return url.toString();
}

/** One page of a provider's model list: its model ids and the cursor for the next page, if any. */
export function parseModelPage(
  kind: ModelListKind,
  body: unknown,
): { models: string[]; next: string | null } {
  const record = (body ?? {}) as Record<string, unknown>;
  if (kind === "google") {
    const models = Array.isArray(record.models) ? record.models : [];
    return {
      models: models
        .filter((m) => {
          const methods = (m as { supportedGenerationMethods?: unknown })
            .supportedGenerationMethods;
          return !Array.isArray(methods) || methods.includes("generateContent");
        })
        .map((m) => String((m as { name?: unknown }).name ?? ""))
        .map((name) => name.replace(/^models\//, "")),
      next:
        typeof record.nextPageToken === "string" && record.nextPageToken
          ? record.nextPageToken
          : null,
    };
  }
  // OpenAI and most compatible APIs answer `{ data: [...] }`; some (Together)
  // answer a bare array.
  const list = Array.isArray(body)
    ? body
    : Array.isArray(record.data)
      ? record.data
      : [];
  const models = list.map((m) =>
    String((m as { id?: unknown }).id ?? (m as { name?: unknown }).name ?? ""),
  );
  const next =
    kind === "anthropic" &&
    record.has_more === true &&
    typeof record.last_id === "string"
      ? record.last_id
      : null;
  return { models, next };
}

export function describeModelListError(status: number): string {
  switch (status) {
    case 401:
      return "The provider rejected the API key (401).";
    case 403:
      return "The API key is not allowed to list models (403).";
    case 404:
      return "This host has no models list (404). Type the model id instead.";
    case 429:
      return "The provider is rate limiting requests (429). Try again shortly.";
    default:
      return `The provider answered ${status} to the models list request.`;
  }
}

export async function fetchModelList(
  settings: AppSettings,
  {
    fetchImpl = fetch,
    now = Date.now,
  }: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<ModelListResult> {
  const apiKey = settings.aiToken?.trim();
  if (!apiKey) return { ok: false, error: "Enter an API key first." };

  const kind = modelListKind(settings);
  let base: string;
  try {
    base = baseUrlFor(kind, settings.aiHost);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const cacheKey = `${kind}|${base}`;
  const hit = cache.get(cacheKey);
  if (hit && now() - hit.at < MODEL_LIST_CACHE_MS) {
    return { ok: true, models: hit.models, cached: true };
  }

  const found = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let response: Response;
    try {
      response = await fetchImpl(pageUrl(kind, base, cursor), {
        headers: headersFor(kind, apiKey),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      return {
        ok: false,
        error: timedOut
          ? `${new URL(base).host} did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`
          : `Could not reach ${new URL(base).host}.`,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: describeModelListError(response.status),
      };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: "The models list was not JSON." };
    }
    const parsed = parseModelPage(kind, body);
    for (const model of parsed.models) if (model) found.add(model);
    cursor = parsed.next;
    if (!cursor) break;
  }

  const models = [...found].sort((a, b) => a.localeCompare(b));
  if (models.length === 0) {
    return { ok: false, error: "The provider listed no models." };
  }
  cache.set(cacheKey, { at: now(), models });
  return { ok: true, models, cached: false };
}
