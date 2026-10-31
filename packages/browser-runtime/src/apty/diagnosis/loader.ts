import { getRedactionMode } from "../../runtime/redaction-mode.js";
import {
  loadBodyDenyList,
  readResourceBody,
} from "../extension-network-inspector.js";
import {
  bodyCandidates,
  type GroupableCall,
} from "../network-resource-groups.js";
import { peerFailureMessage } from "../peers.js";
import { resourceNameFor } from "../resource-body-utils.js";
import {
  ConfiguredServiceWorkerDiagnosticsProvider,
  LIST_RESOURCES_MESSAGE,
} from "../service-worker-diagnostics.js";
import type {
  AptyObservedResource,
  AptyResourceBody,
  AptyResourceList,
} from "../types.js";
import { quotedErrorText } from "./pack-kit.js";
import type { ClientEvidence, LoadedFile } from "./types.js";

export function connectionFailure(list: AptyResourceList): ClientEvidence {
  const failure = list.failure ?? "no_response";
  const message =
    failure === "not_configured"
      ? "No Apty Client extension ID is saved."
      : failure === "malformed_response"
        ? `The Apty Client answered with an unexpected shape (${list.error ?? "unknown"}).`
        : peerFailureMessage("client", failure, LIST_RESOURCES_MESSAGE);
  return {
    connection: { ok: false, failure, message },
    observedNames: [],
    files: {},
  };
}

function toLoadedFile(
  name: string,
  resource: AptyObservedResource,
  read: Awaited<ReturnType<typeof readResourceBody>>,
): LoadedFile {
  const base = { name, httpStatus: resource.status };
  switch (read.status) {
    case "failed":
      return {
        ...base,
        status: "failed",
        ...(resource.errorText !== undefined
          ? { detail: quotedErrorText(resource.errorText) }
          : {}),
      };
    case "pending":
      return { ...base, status: "pending" };
    case "body_denied":
      return { ...base, status: "body_denied", detail: read.deniedBy };
  }
  if (!("body" in read) || read.body === undefined) {
    if ("tooLargeToRedact" in read && read.tooLargeToRedact) {
      return { ...base, status: "too_large_to_redact" };
    }
    return {
      ...base,
      status: read.status === "http_error" ? "http_error" : "body_unavailable",
      detail: "reason" in read ? read.reason : undefined,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(read.body.text);
  } catch {
    return { ...base, status: "unparsable" };
  }
  if (read.status === "http_error") return { ...base, status: "http_error" };
  if (Array.isArray(json) && json.length === 0) {
    return { ...base, status: "empty", json };
  }
  return { ...base, status: "ok", json };
}

/**
 * A call that answered for the file: the newest such call is what the
 * player has now, so an older 200 never stands in for a newer 404.
 */
function settled(file: LoadedFile): boolean {
  return (
    file.status === "ok" ||
    file.status === "empty" ||
    file.status === "http_error" ||
    file.status === "unparsable" ||
    file.status === "body_denied" ||
    file.status === "too_large_to_redact"
  );
}

type ScopeLevel = "tenant" | "app" | "env";
type Scope = Partial<Record<ScopeLevel, string>>;
const SCOPE_SEGMENT = /^(tenant|app|env)-[\w-]+$/;

/** The tenant, app and environment a call's path names (5.x keeps app-urls.json at tenant level). */
function scopeOf(url: string): Scope {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return {};
  }
  const scope: Scope = {};
  for (const segment of path.split("/")) {
    const level = SCOPE_SEGMENT.exec(segment)?.[1] as ScopeLevel | undefined;
    if (level && scope[level] === undefined) scope[level] = segment;
  }
  return scope;
}

/** A call belongs to an environment when each level both name is the same. */
function inScope(url: string, chosen: Scope): boolean {
  const scope = scopeOf(url);
  return (["tenant", "app", "env"] as const).every(
    (level) =>
      scope[level] === undefined ||
      chosen[level] === undefined ||
      scope[level] === chosen[level],
  );
}

const environmentKey = (scope: Scope) =>
  scope.env === undefined
    ? undefined
    : `${scope.tenant ?? ""}/${scope.app ?? ""}/${scope.env}`;

/** How many Apty environments (tenant, app and env) the calls' paths name. */
export function environmentsIn(urls: readonly string[]): number {
  return new Set(urls.flatMap((url) => environmentKey(scopeOf(url)) ?? []))
    .size;
}

/** Where the calls and their bodies come from: the Apty Client, or a HAR file. */
export interface ResourceSource {
  listResources(): Promise<AptyResourceList>;
  getResourceBody(requestId: string): Promise<AptyResourceBody>;
}

/**
 * The named content files as the Apty Client received them, read through the
 * same path as the Widget network calls panel: one list call, then the
 * newest call of each file that has a body, through the body deny list and
 * redaction. A file that cannot be read is a named status, never left out.
 */
export async function loadClientEvidence(
  extensionId: string | undefined,
  names: readonly string[],
): Promise<ClientEvidence> {
  return loadEvidenceFrom(
    new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId,
      peer: "client",
    }),
    names,
  );
}

/** The same reading as `loadClientEvidence`, from any source of calls. */
export async function loadEvidenceFrom(
  provider: ResourceSource,
  names: readonly string[],
): Promise<ClientEvidence> {
  await getRedactionMode();
  const list = await provider.listResources();
  if (!list.ok) return connectionFailure(list);

  const denyList = await loadBodyDenyList();
  const files: Record<string, LoadedFile> = {};
  const requested = list.resources.filter(
    (r) =>
      r.method.toUpperCase() === "GET" &&
      names.includes(resourceNameFor(r.url)),
  );
  // The files of one environment, the newest one's: two tabs, or a HAR
  // recorded across environments or tenants, must not mix their files.
  const newestFirstAll = [...requested].sort(
    (a, b) => b.timestamp - a.timestamp,
  );
  const anchor =
    newestFirstAll.find((r) => scopeOf(r.url).env !== undefined) ??
    newestFirstAll[0];
  const chosenScope = anchor ? scopeOf(anchor.url) : {};
  const environments = environmentsIn(requested.map((r) => r.url));
  for (const name of names) {
    const calls = requested.filter(
      (r) => resourceNameFor(r.url) === name && inScope(r.url, chosenScope),
    );
    const byId = new Map(calls.map((r) => [r.requestId, r]));
    const newestFirst: GroupableCall[] = calls
      .map((r) => ({ ...r, resourceName: name }))
      .sort((a, b) => b.timestamp - a.timestamp);
    let chosen: LoadedFile = { name, status: "not_observed" };
    for (const [index, candidate] of bodyCandidates(newestFirst).entries()) {
      const resource = byId.get(candidate.requestId);
      if (!resource) continue;
      const loaded = toLoadedFile(
        name,
        resource,
        await readResourceBody(provider, resource, denyList),
      );
      if (index === 0 || settled(loaded)) chosen = loaded;
      if (settled(loaded)) break;
    }
    files[name] = chosen;
  }
  return {
    connection: { ok: true },
    observedNames: [
      ...new Set(list.resources.map((r) => resourceNameFor(r.url))),
    ],
    files,
    envId: chosenScope.env,
    ...(environments > 1 ? { environments } : {}),
  };
}
