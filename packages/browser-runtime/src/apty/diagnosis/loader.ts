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
import type { ClientEvidence, LoadedFile } from "./types.js";

const ENV_IN_PATH = /\/(env-[^/?#]+)\//;

function connectionFailure(list: AptyResourceList): ClientEvidence {
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
      return { ...base, status: "failed", detail: resource.errorText };
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

function settled(file: LoadedFile): boolean {
  return (
    file.status === "ok" ||
    file.status === "empty" ||
    file.status === "body_denied" ||
    file.status === "too_large_to_redact"
  );
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
  let envId: string | undefined;
  for (const name of names) {
    const calls = list.resources.filter(
      (r) =>
        r.method.toUpperCase() === "GET" && resourceNameFor(r.url) === name,
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
      envId ??= ENV_IN_PATH.exec(resource.url)?.[1];
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
    envId,
  };
}
