/**
 * The Apty extensions the Agent can talk to over cross-extension messaging
 * (D2): the Client and Studio speak the same `apty-debug-agent:*` contract
 * and handshake, so one code path serves both; only names and where the
 * extension ID is stored differ.
 */
import type { AptyIntegrationConfig } from "./config.js";
import type { ExternalMessageFailure } from "./external-messaging.js";

export type AptyPeer = "client" | "studio";

export const PEER_NAMES: Record<AptyPeer, { full: string; short: string }> = {
  client: { full: "Apty Client", short: "Client" },
  studio: { full: "Apty Studio", short: "Studio" },
};

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/** A Chrome extension ID: 32 letters from a to p. */
export function isValidExtensionId(id: string): boolean {
  return typeof id === "string" && EXTENSION_ID_PATTERN.test(id);
}

/** The client keeps its original `clientExtensionId` field; Studio's ID lives at `peers.studio.extensionId` (an older `studioExtensionId` is still read). */
export function peerExtensionId(
  config: AptyIntegrationConfig,
  peer: AptyPeer,
): string | undefined {
  return peer === "client"
    ? config.clientExtensionId
    : (config.peers?.studio?.extensionId ?? config.studioExtensionId);
}

/** The config patch that stores (or, with `undefined`, clears) a peer's ID. */
export function peerExtensionIdPatch(
  config: AptyIntegrationConfig,
  peer: AptyPeer,
  extensionId: string | undefined,
): Partial<AptyIntegrationConfig> {
  if (peer === "client") return { clientExtensionId: extensionId };
  return {
    studioExtensionId: undefined,
    peers: {
      ...config.peers,
      studio: extensionId ? { extensionId } : undefined,
    },
  };
}

/** Why a peer could not be read, in words that say what to change on its side. */
export function peerFailureMessage(
  peer: AptyPeer,
  failure: ExternalMessageFailure,
  messageType = "apty-debug-agent:get-service-worker-status",
): string {
  const { full, short } = PEER_NAMES[peer];
  switch (failure) {
    case "no_receiver":
      return `Chrome found nothing listening in the ${full} for this extension. The ${short} must list this extension's ID under externally_connectable.ids in its manifest and register a chrome.runtime.onMessageExternal handler at the top level of its service worker.`;
    case "no_response":
      return `The ${full} received the message but answered nothing, so it does not implement the ${messageType} message. Install the Agent bridge module in the ${short}'s service worker.`;
    case "timeout":
      return `The ${full} accepted the message but never answered, even after a retry. Usually its onMessageExternal handler does not implement the ${messageType} message (install or update the Agent bridge module); otherwise its service worker is stuck, so check chrome://extensions for errors on the ${short}.`;
    case "send_failed":
      return `Chrome refused to send the message to the ${full}.`;
  }
}

/** The one change that fixes `no_receiver`, with this Agent's ID filled in. */
export function allowListFix(peer: AptyPeer, agentId: string): string {
  return `${PEER_NAMES[peer].full}'s manifest must list this Agent ID in externally_connectable.ids: "${agentId}"`;
}
