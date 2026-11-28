/**
 * One replay source per open case (conversation): its cache and the Apty
 * context the SE or a tool pinned for it. In memory only; forgotten when the
 * case's evidence is cleared.
 */
import type { AptyContentContext, AptyFileResult } from "@apty/agent-core";
import { policyOf } from "@apty/agent-core";
import { loadOrgPolicy } from "../../runtime/org-policy.js";
import { type AptyPage, tabAptyPage } from "../apty-cdn-source.js";
import type { ResourceSource } from "../diagnosis/loader.js";
import { loadBodyDenyList } from "../extension-network-inspector.js";
import type { AptyObservedResource, AptyResourceBody } from "../types.js";
import {
  createReplaySource,
  type ReplayDeps,
  type ReplaySource,
} from "./content-source.js";

interface CaseReplay {
  source: ReplaySource;
  tabId?: number;
  pinned?: AptyContentContext;
}

const UNSCOPED = "__unscoped__";
/** Open cases kept at once; the oldest is forgotten past this. */
const MAX_CASES = 20;
const cases = new Map<string, CaseReplay>();

/** The organization policy's `aptyContentOrigins`, read on every call so a policy change applies at once. */
export async function policyContentOrigins(): Promise<readonly string[]> {
  const policy = policyOf(await loadOrgPolicy());
  return policy?.aptyContentOrigins ?? [];
}

/** The tab the case is bound to now, read on every probe. */
function casePage(entry: CaseReplay): AptyPage {
  const current = () =>
    entry.tabId === undefined ? undefined : tabAptyPage(entry.tabId);
  return {
    probe: async () =>
      current()?.probe() ?? { ok: false, reason: "not-readable" },
    userValue: async (source, key) => current()?.userValue(source, key),
  };
}

let makeSource = (deps: ReplayDeps): ReplaySource => createReplaySource(deps);

/** @internal */
export function setReplaySourceFactoryForTests(
  factory: (deps: ReplayDeps) => ReplaySource,
): void {
  makeSource = factory;
  cases.clear();
}

export function caseReplay(
  conversationId: string | undefined,
  tabId?: number,
): CaseReplay {
  const key = conversationId ?? UNSCOPED;
  let entry = cases.get(key);
  if (!entry) {
    const created: CaseReplay = {} as CaseReplay;
    created.source = makeSource({
      page: casePage(created),
      policyOrigins: policyContentOrigins,
      denyList: loadBodyDenyList,
    });
    entry = created;
    cases.set(key, entry);
    for (const old of cases.keys()) {
      if (cases.size <= MAX_CASES) break;
      forgetCase(old === UNSCOPED ? undefined : old);
    }
  }
  if (tabId !== undefined) entry.tabId = tabId;
  return entry;
}

/** The context the check packs read with for this case, instead of the page's. */
export function pinContext(
  conversationId: string | undefined,
  context: AptyContentContext,
): void {
  caseReplay(conversationId).pinned = context;
}

export function pinnedContext(
  conversationId: string | undefined,
): AptyContentContext | undefined {
  return cases.get(conversationId ?? UNSCOPED)?.pinned;
}

export function forgetCase(conversationId: string | undefined): void {
  const key = conversationId ?? UNSCOPED;
  cases.get(key)?.source.clear();
  cases.delete(key);
}

/** How a replayed file shows in a call list the loader reads like the Client's. */
function asCall(
  result: AptyFileResult,
  base: string,
  index: number,
  at: number,
): { resource: AptyObservedResource; body?: string } | undefined {
  if (!result.path) return undefined;
  const resource: AptyObservedResource = {
    requestId: `replay-${index}`,
    url: `${base}/${result.path}`,
    method: "GET",
    timestamp: at + index,
    mimeType: "application/json",
  };
  if (result.ok) {
    return {
      resource: { ...resource, status: result.httpStatus, hasBody: true },
      body: result.text,
    };
  }
  if (result.failure === "unknown_file" || result.failure === "ids_missing") {
    return undefined;
  }
  if (result.failure === "not_published") {
    return { resource: { ...resource, status: 404, hasBody: false } };
  }
  if (result.failure === "body_denied") {
    return { resource: { ...resource, status: 200, hasBody: false } };
  }
  if (result.failure.startsWith("http_")) {
    return {
      resource: { ...resource, status: result.httpStatus, hasBody: false },
    };
  }
  return {
    resource: {
      ...resource,
      failed: true,
      status: 0,
      errorText: `${result.failure}: ${result.detail}`,
    },
  };
}

/**
 * The named files, replayed for `context`, as a source the check packs'
 * loader reads exactly like the Client's record. `fresh`: ask the host again
 * (conditional when the case has the file), so Re-check sees a new publish.
 */
export function replayResourceSource(
  source: ReplaySource,
  context: AptyContentContext,
  names: readonly string[],
  {
    fresh = true,
    now = Date.now,
  }: { fresh?: boolean; now?: () => number } = {},
): ResourceSource {
  let loading:
    | Promise<{
        resources: AptyObservedResource[];
        bodies: Map<string, string>;
      }>
    | undefined;
  const load = async () => {
    const at = now();
    const resources: AptyObservedResource[] = [];
    const bodies = new Map<string, string>();
    for (const [index, name] of names.entries()) {
      const result = await source.fetchFile(context, name, {}, { fresh });
      const call = asCall(result, context.contentURL, index, at);
      if (!call) continue;
      resources.push(call.resource);
      if (call.body !== undefined)
        bodies.set(call.resource.requestId, call.body);
    }
    return { resources, bodies };
  };
  const loaded = () => {
    loading ??= load();
    return loading;
  };
  return {
    listResources: async () => ({
      ok: true,
      resources: (await loaded()).resources,
    }),
    getResourceBody: async (requestId): Promise<AptyResourceBody> => {
      const body = (await loaded()).bodies.get(requestId);
      return body === undefined
        ? { found: false, reason: "none" }
        : { found: true, body, base64Encoded: false };
    },
  };
}
