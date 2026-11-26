/**
 * The Agent's own reader of Apty's published content (replay): the GET
 * requests the Apty player makes to its content host, made from the Agent's
 * service worker, for a tenant, application and environment taken from the
 * page or given by the SE. See docs/development/replay-network-source.md.
 *
 * - Hosts: the content URL the page's Apty config names, or an origin in the
 *   organization policy's `aptyContentOrigins`; never one from free text.
 * - Requests: GET only, no credentials, no redirects, a file from the
 *   catalogue only, with the player's own `?timestamp=` when it can be
 *   reproduced (5.x `file-timestamp.ts`).
 * - Bodies: the body deny list first, then the same redaction as the
 *   Client's record (`readResourceBody`); kept in memory for the case only.
 */
import {
  type AptyContentContext,
  type AptyContentSource,
  type AptyContextInput,
  type AptyContextResult,
  type AptyFetchFailure,
  type AptyFileExtra,
  type AptyFileResult,
  httpFailure,
} from "@apty/agent-core";
import { type AptyPage, activeIds } from "../apty-cdn-source.js";
import { readResourceBody } from "../extension-network-inspector.js";
import { matchingDenyEntry } from "../resource-body-utils.js";
import { filePath, filesOf, PATH_SAFE } from "./catalogue.js";
import { checkSchema } from "./schemas.js";

export interface ReplayFetchOptions {
  /** Ask the host again (Re-check), with a conditional request when the cache has a validator. */
  fresh?: boolean;
}

export interface ReplaySource extends AptyContentSource {
  fetchFile(
    context: AptyContentContext,
    file: string,
    extra?: AptyFileExtra,
    options?: ReplayFetchOptions,
  ): Promise<AptyFileResult>;
  /** Drop every cached body: the case is closed. */
  clear(): void;
}

export interface ReplayDeps {
  /** The tab's Apty config; absent when the SE gives every ID. */
  page?: AptyPage;
  /** Origins the organization policy allows besides the page's own content URL. */
  policyOrigins?: () => Promise<readonly string[]>;
  denyList?: () => Promise<readonly string[]>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** @internal */
export const MAX_REPLAY_BODY_CHARS = 5_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An https base, or http on this machine (tests), with no trailing slash. */
export function usableBase(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const local =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      return undefined;
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
      return undefined;
    return url.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/**
 * A host a page may not name as its content URL (SSRF): a private,
 * link-local or shared IPv4 literal, or any IPv6 literal. Apty's content
 * hosts are never IPv6 literals, and embedded IPv4 forms (`::ffff:a00:5`)
 * would otherwise slip past a range check, so IPv6 fails closed. IPv4 is
 * read after the URL parser normalizes decimal and hex forms. Loopback
 * stays allowed, as for the existing content-CDN fallback (and its tests).
 */
export function isPrivateNetworkHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host.startsWith("[")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 10 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/**
 * The player's `?timestamp=` for a file: the number at `path` in
 * content-config.json, else the nearest `latest` on the way, else now
 * (5.x `file-timestamp.ts` `getFileTimestamp`).
 */
export function fileTimestamp(
  contentConfig: unknown,
  path: readonly string[],
  now: () => number,
): number {
  if (!isRec(contentConfig)) return now();
  let current: unknown = contentConfig;
  let latest =
    typeof contentConfig.latest === "number" ? contentConfig.latest : undefined;
  for (const key of path) {
    if (!isRec(current)) return latest ?? now();
    if ("latest" in current) {
      latest = typeof current.latest === "number" ? current.latest : undefined;
    }
    if (!(key in current)) return latest ?? now();
    current = current[key];
  }
  return typeof current === "number" ? current : (latest ?? now());
}

/** The player's content-config.json can wrap its keys in `payload` (5.x `cdn.service.ts` `getContentConfig`). */
function flattenContentConfig(json: unknown): unknown {
  if (!isRec(json) || !isRec(json.payload)) return json;
  const { payload, error: _error, ...rest } = json;
  return { ...rest, ...payload };
}

/** CloudFront answers an unpublished file with 200 and a `status: 404` body (5.x `axios-client.ts`). */
export const isNotFoundBody = (json: unknown) =>
  isRec(json) && json.status === 404;

interface CacheEntry {
  result: AptyFileResult & { ok: true };
  etag?: string;
  lastModified?: string;
}

const fail = (
  file: string,
  failure: AptyFetchFailure,
  detail: string,
  extra: { path?: string; httpStatus?: number } = {},
): AptyFileResult => ({ ok: false, file, failure, detail, ...extra });

export function createReplaySource({
  page,
  policyOrigins = async () => [],
  denyList = async () => [],
  fetchImpl = (input, init) => fetch(input, init),
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ReplayDeps = {}): ReplaySource {
  const cache = new Map<string, CacheEntry>();
  /** Paths the host said hold nothing, for the case: not asked again until `fresh`. */
  const unpublished = new Map<string, AptyFileResult>();
  /** Bases a context was resolved for: the only hosts `fetchFile` calls. */
  const allowedBases = new Set<string>();

  async function request(
    url: string,
    headers: Record<string, string>,
  ): Promise<Response | "timeout" | Error> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return "timeout";
      return error instanceof Error ? error : new Error("The request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  async function timestampFor(
    context: AptyContentContext,
    file: string,
    scope: string,
  ): Promise<number> {
    if (context.version !== "5.x" || scope === "user") return now();
    if (file === "content-config.json") return now();
    const config = await fetchFile(context, "content-config.json");
    const json = config.ok ? flattenContentConfig(config.json) : undefined;
    const app = `app-${context.applicationId}`;
    const keys =
      scope === "tenant"
        ? [file]
        : scope === "application"
          ? [app, file]
          : [app, `env-${context.environmentId}`, file];
    return fileTimestamp(json, keys, now);
  }

  async function fetchFile(
    context: AptyContentContext,
    file: string,
    extra: AptyFileExtra = {},
    { fresh = false }: ReplayFetchOptions = {},
  ): Promise<AptyFileResult> {
    const base = usableBase(context.contentURL);
    if (!base || !allowedBases.has(base)) {
      return fail(
        file,
        "host_not_allowed",
        "The content host is neither the page's Apty content URL nor one the organization policy allows.",
      );
    }
    const built = filePath(context, file, extra);
    if (!built.ok) return fail(file, built.failure, built.detail);
    const { path, spec } = built;
    const key = `${base}/${path}`;
    const cached = cache.get(key);
    if (cached && !fresh) return { ...cached.result, fromCache: true };
    const missing = unpublished.get(key);
    if (missing && !fresh) return missing;
    unpublished.delete(key);

    const denied = matchingDenyEntry(key, await denyList());
    if (denied !== null) {
      return fail(
        file,
        "body_denied",
        `The URL matches "${denied}" in the body deny list (Settings → Data handling), so it was not requested.`,
        { path },
      );
    }
    const timestamp = await timestampFor(context, file, spec.scope);
    // 4.x appends an empty token to every content GET (player3.0 `appendToken`).
    const url = `${key}?timestamp=${timestamp}${context.version === "4.x" ? "&token=" : ""}`;
    const headers: Record<string, string> = {};
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified)
      headers["If-Modified-Since"] = cached.lastModified;

    const response = await request(url, headers);
    if (response === "timeout") {
      return fail(file, "timeout", `No answer within ${timeoutMs} ms.`, {
        path,
      });
    }
    if (response instanceof Error) {
      return fail(file, "network", response.message, { path });
    }
    if (response.status === 304 && cached) {
      const result = { ...cached.result, fetchedAt: now() };
      cache.set(key, { ...cached, result });
      return { ...result, fromCache: true };
    }
    if (!response.ok) {
      const failed = fail(
        file,
        httpFailure(response.status),
        `The content host answered HTTP ${response.status}.`,
        { path, httpStatus: response.status },
      );
      if (response.status === 404) unpublished.set(key, failed);
      return failed;
    }
    const raw = await response.text();
    if (raw.length > MAX_REPLAY_BODY_CHARS) {
      return fail(file, "too_large", `${raw.length} characters.`, {
        path,
        httpStatus: response.status,
      });
    }
    const read = await readResourceBody(
      {
        getResourceBody: async () => ({
          found: true,
          body: raw,
          base64Encoded: false,
        }),
      },
      {
        requestId: key,
        url: key,
        method: "GET",
        timestamp: now(),
        status: response.status,
        mimeType: "application/json",
      },
      [],
    );
    if (!("body" in read) || !read.body) {
      return fail(
        file,
        "too_large",
        "The body is too large to redact safely.",
        {
          path,
          httpStatus: response.status,
        },
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(read.body.text);
    } catch {
      return fail(file, "unparsable", "The body is not JSON.", {
        path,
        httpStatus: response.status,
      });
    }
    if (isNotFoundBody(json)) {
      const failed = fail(
        file,
        "not_published",
        "The content host answered with its not-found page: nothing is published at this path.",
        { path, httpStatus: response.status },
      );
      unpublished.set(key, failed);
      return failed;
    }
    const schema = checkSchema(context.version, spec.name, json);
    if (schema.checked && !schema.ok) {
      return fail(file, "schema_mismatch", schema.issue, {
        path,
        httpStatus: response.status,
      });
    }
    const result = {
      ok: true as const,
      file,
      path,
      httpStatus: response.status,
      text: read.body.text,
      json,
      fetchedAt: now(),
      fromCache: false,
    };
    cache.set(key, {
      result,
      ...(response.headers.get("etag")
        ? { etag: response.headers.get("etag") as string }
        : {}),
      ...(response.headers.get("last-modified")
        ? { lastModified: response.headers.get("last-modified") as string }
        : {}),
    });
    return result;
  }

  async function contentBase(
    given: string | undefined,
    fromPage: string | undefined,
  ): Promise<
    | { ok: true; base: string }
    | { ok: false; failure: "host_not_allowed" | "ids_missing"; detail: string }
  > {
    const allowed = (await policyOrigins()).map((o) => o.toLowerCase());
    const pageBase = fromPage ? usableBase(fromPage) : undefined;
    if (given) {
      const base = usableBase(given);
      const origin = base ? originOf(base) : undefined;
      if (
        base &&
        origin &&
        (allowed.includes(origin.toLowerCase()) ||
          (pageBase !== undefined && originOf(pageBase) === origin))
      ) {
        return { ok: true, base };
      }
      return {
        ok: false,
        failure: "host_not_allowed",
        detail:
          "That content host is not the page's Apty content URL nor in the organization policy's aptyContentOrigins.",
      };
    }
    if (pageBase) {
      const origin = originOf(pageBase)?.toLowerCase();
      if (
        isPrivateNetworkHost(pageBase) &&
        !(origin && allowed.includes(origin))
      ) {
        return {
          ok: false,
          failure: "host_not_allowed",
          detail:
            "The page names a content URL on a private network address; it is used only if the organization policy's aptyContentOrigins lists it.",
        };
      }
      return { ok: true, base: pageBase };
    }
    const [only, ...more] = allowed;
    if (only && more.length === 0) return { ok: true, base: only };
    return {
      ok: false,
      failure: more.length > 0 ? "ids_missing" : "host_not_allowed",
      detail:
        more.length > 0
          ? "Several content hosts are allowed: name the one to use."
          : "No content host: the page has no Apty config and the organization policy names none.",
    };
  }

  async function resolveContext(
    input: AptyContextInput = {},
  ): Promise<AptyContextResult> {
    const probe = page ? await page.probe().catch(() => undefined) : undefined;
    const config = probe?.ok ? probe.config : undefined;
    const tenantId = input.tenantId ?? config?.tenantId;
    if (!tenantId || !PATH_SAFE.test(tenantId)) {
      return {
        ok: false,
        failure: !tenantId && page && !config ? "no_apty" : "ids_missing",
        detail: tenantId
          ? "The tenant ID is not a plain path segment."
          : "No tenant ID: give one, or open a page where Apty runs.",
      };
    }
    const host = await contentBase(input.contentURL, config?.contentURL);
    if (!host.ok)
      return { ok: false, failure: host.failure, detail: host.detail };
    allowedBases.add(host.base);
    const version = input.version ?? "5.x";
    const context: AptyContentContext = {
      version,
      contentURL: host.base,
      tenantId,
      ...(config ? { mode: config.mode } : {}),
      idsFrom: { tenant: input.tenantId ? "given" : "page" },
    };
    for (const id of [input.applicationId, input.environmentId]) {
      if (id !== undefined && !PATH_SAFE.test(id)) {
        return {
          ok: false,
          failure: "ids_missing",
          detail: "An ID is not a plain path segment.",
        };
      }
    }
    if (input.applicationId && input.environmentId) {
      return {
        ok: true,
        context: {
          ...context,
          applicationId: input.applicationId,
          environmentId: input.environmentId,
          idsFrom: { ...context.idsFrom, environment: "given" },
        },
      };
    }
    if (version === "4.x") {
      return {
        ok: false,
        failure: "ids_missing",
        detail: "For Apty 4.x, give the application ID and environment number.",
      };
    }
    const appUrls = await fetchFile(context, "app-urls.json");
    if (!appUrls.ok) {
      return {
        ok: false,
        failure: appUrls.failure,
        detail: `app-urls.json: ${appUrls.detail}`,
      };
    }
    const apps = appUrls.json as Array<{
      id: string;
      environments: Array<{ id: string }>;
    }>;
    if (input.environmentId) {
      const app = apps.find(
        (a) =>
          (!input.applicationId || a.id === input.applicationId) &&
          a.environments.some((e) => e.id === input.environmentId),
      );
      if (!app) {
        return {
          ok: false,
          failure: "no_environment_match",
          detail: "No application in app-urls.json has that environment.",
        };
      }
      return {
        ok: true,
        context: {
          ...context,
          applicationId: app.id,
          environmentId: input.environmentId,
          idsFrom: { ...context.idsFrom, environment: "given" },
        },
      };
    }
    const ids = config?.pageUrl ? activeIds(apps, config.pageUrl) : undefined;
    const matched =
      ids && (!input.applicationId || ids.appId === input.applicationId)
        ? ids
        : undefined;
    if (!matched) {
      return {
        ok: false,
        failure: "no_environment_match",
        detail: config?.pageUrl
          ? "No environment's URL pattern in app-urls.json matches this page."
          : "Give the environment ID: there is no page URL to match.",
      };
    }
    return {
      ok: true,
      context: {
        ...context,
        applicationId: matched.appId,
        environmentId: matched.envId,
        idsFrom: { ...context.idsFrom, environment: "url-match" },
      },
    };
  }

  return {
    resolveContext,
    listFiles: filesOf,
    fetchFile,
    clear: () => {
      cache.clear();
      unpublished.clear();
      allowedBases.clear();
    },
  };
}
