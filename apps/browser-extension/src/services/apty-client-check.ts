import {
  type AptyPeer,
  allowListFix,
  PEER_NAMES,
} from "@apty/browser-runtime/apty/peers";
import { ConfiguredServiceWorkerDiagnosticsProvider } from "@apty/browser-runtime/apty/service-worker-diagnostics";

export type ClientCheck =
  | { status: "ok" }
  | { status: "not_answering"; message: string; fix?: string }
  | { status: "error"; message: string };

/** `undefined` when the optional `management` permission isn't granted, so installation can't be checked. */
export async function isInstalledAndEnabled(
  id: string,
): Promise<boolean | undefined> {
  if (!chrome.management?.get) return undefined;
  try {
    const info = await chrome.management.get(id);
    return info.enabled;
  } catch {
    return false;
  }
}

/** Installed check (when permitted), then the real message handshake with the Apty Client or Studio. */
export async function checkPeer(
  peer: AptyPeer,
  id: string,
): Promise<ClientCheck> {
  if ((await isInstalledAndEnabled(id)) === false) {
    return {
      status: "error",
      message: `The specified ${PEER_NAMES[peer].full} extension could not be found or is not currently available.`,
    };
  }
  const status = await new ConfiguredServiceWorkerDiagnosticsProvider({
    extensionId: id,
    peer,
  }).getStatus();
  if (status.status === "ok") return { status: "ok" };
  return {
    status: "not_answering",
    message: status.error ?? `The ${PEER_NAMES[peer].full} did not answer.`,
    ...(status.peerFailure === "no_receiver" && chrome.runtime?.id
      ? { fix: allowListFix(peer, chrome.runtime.id) }
      : {}),
  };
}

export function checkClient(id: string): Promise<ClientCheck> {
  return checkPeer("client", id);
}
