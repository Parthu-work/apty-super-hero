/**
 * The Agent's own reader of Apty's published content (replay): the GET
 * requests the Apty player makes to its content host, made from the side
 * panel (the MCP bridge runs the same code in the service worker), for a
 * tenant, application and environment taken from the page or given by the
 * SE. See docs/development/replay-network-source.md.
 *
 * - Hosts: every host, from the page, the SE, a tool call or the policy,
 *   passes `checkContentHost` (AUDIT-CORRECTIONS A1); never one from free text.
 * - Requests: GET only, no credentials, no redirects, a file from the
 *   catalogue only, with the player's own `?timestamp=` when it can be
 *   reproduced (5.x `file-timestamp.ts`). The time limit covers the whole
 *   body; bodies are read with a byte cap per file and per case, and closing
 *   the case aborts what is under way (A2).
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
  checkContentHost,
  httpFailure,
  idShapeIssue,
} from "@apty/agent-core";
import { type AptyPage, activeIds } from "../apty-cdn-source.js";
import { readResourceBody } from "../extension-network-inspector.js";
import { matchingDenyEntry } from "../resource-body-utils.js";
import { filePath, filesOf } from "./catalogue.js";
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
  /** The case is closed: abort every request under way and drop every cached body. */
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
  /** For the whole request, body included. */
  timeoutMs?: number;
  maxFileBytes?: number;
  maxCaseBytes?: number;
  /** Aborts every request of the case, as `clear()` does. */
  signal?: AbortSignal;
}

/** @internal */
export const MAX_REPLAY_FILE_BYTES = 5_000_000;
/** @internal */
export const MAX_REPLAY_CASE_BYTES = 25_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The player's `?timestamp=` for a file: the number at `path` in
 * content-config.json, else the nearest `latest` on the way, else now
 * (5.x `file-timestamp.ts` `getFileTimestamp`).
 */
/** @internal */
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

type BodyRead =
  | { ok: true; text: string }
  | { ok: false; reason: "file_limit" | "case_limit" | "stopped" };

/** What stopped a request: the case closing wins over the time limit. */
type Stop = "aborted" | "timeout";

const stoppedFailure = (
  file: string,
  stop: Stop,
  path: string,
): AptyFileResult =>
  stop === "aborted"
    ? fail(file, "aborted", "The case was closed before the answer arrived.", {
        path,
      })
    : fail(file, "timeout", "No complete answer within the time limit.", {
        path,
      });

export function createReplaySource({
  page,
  policyOrigins = async () => [],
  denyList = async () => [],
  fetchImpl = (input, init) => fetch(input, init),
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxFileBytes = MAX_REPLAY_FILE_BYTES,
  maxCaseBytes = MAX_REPLAY_CASE_BYTES,
  signal: externalSignal,
}: ReplayDeps = {}): ReplaySource {
  const cache = new Map<string, CacheEntry>();
  /** Paths the host said hold nothing, for the case: not asked again until `fresh`. */
  const unpublished = new Map<string, AptyFileResult>();
  /** Requests under way: a second caller for the same file waits for the first instead of asking again. */
  const inFlight = new Map<string, Promise<AptyFileResult>>();
  /** Bases a context was resolved for: the only hosts `fetchFile` calls. */
  const allowedBases = new Set<string>();
  let caseController = new AbortController();
  let caseBytes = 0;

  /** A request's own signal: its time limit, the case closing, or the caller's signal. */
  function startCall() {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const caseSignal = caseController.signal;
    const signals = [timeout.signal, caseSignal];
    if (externalSignal) signals.push(externalSignal);
    return {
      signal: AbortSignal.any(signals),
      stop: (): Stop | undefined =>
        caseSignal.aborted || externalSignal?.aborted
          ? "aborted"
          : timeout.signal.aborted
            ? "timeout"
            : undefined,
      end: () => clearTimeout(timer),
    };
  }

  async function request(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Response | Error> {
    try {
      return await fetchImpl(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers,
        signal,
      });
    } catch (error) {
      return error instanceof Error ? error : new Error("The request failed");
    }
  }

  /**
   * The body as text, read as a stream so no more than the per-file and
   * per-case byte caps is ever held, and stopped as soon as `signal` fires
   * (a stalled or slowly dripping body otherwise holds the request open).
   */
  async function readBody(
    response: Response,
    signal: AbortSignal,
  ): Promise<BodyRead> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxFileBytes) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "file_limit" };
    }
    if (!response.body) return { ok: true, text: "" };
    const reader = response.body.getReader();
    const stopped = new Promise<"stopped">((resolve) => {
      if (signal.aborted) resolve("stopped");
      signal.addEventListener("abort", () => resolve("stopped"), {
        once: true,
      });
    });
    const decoder = new TextDecoder();
    let text = "";
    let fileBytes = 0;
    try {
      for (;;) {
        const next = await Promise.race([reader.read(), stopped]);
        if (next === "stopped") return { ok: false, reason: "stopped" };
        if (next.done) return { ok: true, text: text + decoder.decode() };
        fileBytes += next.value.byteLength;
        caseBytes += next.value.byteLength;
        if (fileBytes > maxFileBytes)
          return { ok: false, reason: "file_limit" };
        if (caseBytes > maxCaseBytes)
          return { ok: false, reason: "case_limit" };
        text += decoder.decode(next.value, { stream: true });
      }
    } catch {
      return { ok: false, reason: "stopped" };
    } finally {
      reader.cancel().catch(() => undefined);
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

  function fetchFile(
    context: AptyContentContext,
    file: string,
    extra: AptyFileExtra = {},
    options: ReplayFetchOptions = {},
  ): Promise<AptyFileResult> {
    const key = JSON.stringify([
      context.version,
      context.contentURL,
      context.tenantId,
      context.applicationId,
      context.environmentId,
      file,
      extra.userId,
      extra.chatId,
      extra.workflowId,
      options.fresh === true,
    ]);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const started = fetchFileOnce(context, file, extra, options).finally(() =>
      inFlight.delete(key),
    );
    inFlight.set(key, started);
    return started;
  }

  async function fetchFileOnce(
    context: AptyContentContext,
    file: string,
    extra: AptyFileExtra,
    { fresh = false }: ReplayFetchOptions,
  ): Promise<AptyFileResult> {
    const base = context.contentURL.replace(/\/+$/, "");
    if (!allowedBases.has(base)) {
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

    const call = startCall();
    let raw: string;
    let response: Response | Error;
    try {
      response = await request(url, headers, call.signal);
      const stop = call.stop();
      if (stop) return stoppedFailure(file, stop, path);
      if (response instanceof Error) {
        return fail(file, "network", response.message, { path });
      }
      if (response.status === 304 && cached) {
        await response.body?.cancel().catch(() => undefined);
        const result = { ...cached.result, fetchedAt: now() };
        cache.set(key, { ...cached, result });
        return { ...result, fromCache: true };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const failed = fail(
          file,
          httpFailure(response.status),
          `The content host answered HTTP ${response.status}.`,
          { path, httpStatus: response.status },
        );
        if (response.status === 404) unpublished.set(key, failed);
        return failed;
      }
      const body = await readBody(response, call.signal);
      if (!body.ok) {
        if (body.reason === "stopped") {
          return stoppedFailure(file, call.stop() ?? "aborted", path);
        }
        return fail(
          file,
          "too_large",
          body.reason === "file_limit"
            ? `The file is over ${maxFileBytes} bytes, the limit for one file.`
            : `This case has read over ${maxCaseBytes} bytes of Apty content, the limit for one case.`,
          { path, httpStatus: response.status },
        );
      }
      raw = body.text;
    } finally {
      call.end();
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

  /** The content host for the case: the one given, else the page's, else the policy's only origin; each through the one gate. */
  async function contentBase(
    given: string | undefined,
    fromPage: string | undefined,
    version: AptyContentContext["version"],
  ): Promise<
    | { ok: true; base: string }
    | { ok: false; failure: "host_not_allowed" | "ids_missing"; detail: string }
  > {
    const allowed = await policyOrigins();
    const named = given ?? fromPage;
    if (named) {
      const verdict = checkContentHost(named, version, allowed);
      return verdict.ok
        ? verdict
        : { ok: false, failure: "host_not_allowed", detail: verdict.detail };
    }
    const [only, ...more] = allowed;
    if (only && more.length === 0) {
      const verdict = checkContentHost(only, version, allowed);
      if (verdict.ok) return verdict;
    }
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
    const version = input.version ?? "5.x";
    if (!tenantId) {
      return {
        ok: false,
        failure: page && !config ? "no_apty" : "ids_missing",
        detail: "No tenant ID: give one, or open a page where Apty runs.",
      };
    }
    const shapeIssue =
      idShapeIssue(version, "tenant", tenantId) ??
      (input.applicationId === undefined
        ? undefined
        : idShapeIssue(version, "application", input.applicationId)) ??
      (input.environmentId === undefined
        ? undefined
        : idShapeIssue(version, "environment", input.environmentId));
    if (shapeIssue) {
      return { ok: false, failure: "ids_missing", detail: shapeIssue };
    }
    const host = await contentBase(
      input.contentURL,
      config?.contentURL,
      version,
    );
    if (!host.ok)
      return { ok: false, failure: host.failure, detail: host.detail };
    allowedBases.add(host.base);
    const context: AptyContentContext = {
      version,
      contentURL: host.base,
      tenantId,
      ...(config ? { mode: config.mode } : {}),
      idsFrom: { tenant: input.tenantId ? "given" : "page" },
    };
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
      caseController.abort();
      caseController = new AbortController();
      caseBytes = 0;
      cache.clear();
      unpublished.clear();
      inFlight.clear();
      allowedBases.clear();
    },
  };
}
