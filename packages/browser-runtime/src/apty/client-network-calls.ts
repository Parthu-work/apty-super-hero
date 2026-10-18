/**
 * Options' "Widget network calls" panel: what the Apty Client reports having
 * requested, and one body on demand, with no model involved. The list gets
 * the same URL policy as the chat tools' results; bodies go through the same
 * deny list and redaction as `inspect_extension_network`.
 */
import { getRedactionMode, redactText } from "../runtime/redaction-mode.js";
import { applyResultPrivacy } from "../runtime/result-privacy.js";
import { currentValuePolicy } from "../runtime/value-policy.js";
import {
  loadBodyDenyList,
  type ResourceBodyRead,
  readResourceBody,
} from "./extension-network-inspector.js";
import { allowListFix, PEER_NAMES, peerFailureMessage } from "./peers.js";
import {
  ConfiguredServiceWorkerDiagnosticsProvider,
  LIST_RESOURCES_MESSAGE,
  MAX_RESOURCES_KEPT,
} from "./service-worker-diagnostics.js";
import { shownResourceName, shownUrl } from "./shown-url.js";
import type { AptyObservedResource, AptyResourceList } from "./types.js";

export interface NetworkCall extends AptyObservedResource {
  resourceName: string;
}

export type NetworkCallsFailure = NonNullable<AptyResourceList["failure"]>;

export interface NetworkCallsUnavailable {
  failure: NetworkCallsFailure;
  message: string;
  /** For `no_receiver`: the manifest change, with this Agent's ID. */
  fix?: string;
}

export type NetworkCallList =
  | { ok: true; calls: NetworkCall[]; mayBeBounded: boolean }
  | ({ ok: false } & NetworkCallsUnavailable);

export type NetworkCallBody =
  | ({ status: "not_connected" } & NetworkCallsUnavailable)
  | { status: "not_observed" }
  | ({ call: NetworkCall } & ResourceBodyRead);

function unavailable(
  list: AptyResourceList,
  agentId: string | undefined,
): NetworkCallsUnavailable {
  const failure = list.failure ?? "no_response";
  const name = PEER_NAMES.client.full;
  switch (failure) {
    case "not_configured":
      return {
        failure,
        message: `No ${name} extension ID is saved. Save the ${name}'s ID above first.`,
      };
    case "malformed_response":
      return {
        failure,
        message: `The ${name} answered with an unexpected shape (${list.error ?? "unknown"}). Its bridge module is likely out of date.`,
      };
    default:
      return {
        failure,
        message: peerFailureMessage("client", failure, LIST_RESOURCES_MESSAGE),
        ...(failure === "no_receiver" && agentId
          ? { fix: allowListFix("client", agentId) }
          : {}),
      };
  }
}

/**
 * The URL and name as the current mode shows them, built from the raw URL so
 * a relative one is masked too (and an unparsable one is dropped, never
 * shown raw). Call `getRedactionMode()` first.
 */
function toNetworkCall(resource: AptyObservedResource): NetworkCall {
  const call = applyResultPrivacy(
    {
      ...resource,
      ...(resource.errorText !== undefined
        ? { errorText: redactText(resource.errorText) }
        : {}),
    },
    currentValuePolicy(),
  ) as AptyObservedResource;
  return {
    ...call,
    url: shownUrl(resource.url),
    resourceName: shownResourceName(resource.url),
  };
}

async function fetchList(extensionId: string | undefined) {
  await getRedactionMode();
  const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
    extensionId,
    peer: "client",
  });
  return { provider, list: await provider.listResources() };
}

/** Every call the Apty Client reports, oldest first, with URLs under the current redaction mode's policy. */
export async function listClientNetworkCalls(
  extensionId: string | undefined,
  agentId: string | undefined = globalThis.chrome?.runtime?.id,
): Promise<NetworkCallList> {
  const { list } = await fetchList(extensionId);
  if (!list.ok) return { ok: false, ...unavailable(list, agentId) };
  return {
    ok: true,
    calls: list.resources.map(toNetworkCall),
    mayBeBounded: list.resources.length >= MAX_RESOURCES_KEPT,
  };
}

/** One call's body, found again by `requestId` in a fresh list, so a call the Client has since dropped reads as `not_observed`. */
export async function readClientNetworkCallBody(
  extensionId: string | undefined,
  requestId: string,
  agentId: string | undefined = globalThis.chrome?.runtime?.id,
): Promise<NetworkCallBody> {
  const { provider, list } = await fetchList(extensionId);
  if (!list.ok) {
    return { status: "not_connected", ...unavailable(list, agentId) };
  }
  const resource = list.resources.find((r) => r.requestId === requestId);
  if (!resource) return { status: "not_observed" };
  const read = await readResourceBody(
    provider,
    resource,
    await loadBodyDenyList(),
  );
  await getRedactionMode();
  return { call: toNetworkCall(resource), ...read };
}
