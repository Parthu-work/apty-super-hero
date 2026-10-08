import { ConfiguredServiceWorkerDiagnosticsProvider } from "@apty/browser-runtime/apty/service-worker-diagnostics";

export type ClientCheck =
  | { status: "ok" }
  | { status: "not_answering"; message: string }
  | { status: "error"; message: string };

const NOT_FOUND_MESSAGE =
  "The specified Apty Client extension could not be found or is not currently available.";

/** `undefined` when the optional `management` permission isn't granted, so installation can't be checked. */
async function isInstalledAndEnabled(id: string): Promise<boolean | undefined> {
  if (!chrome.management?.get) return undefined;
  try {
    const info = await chrome.management.get(id);
    return info.enabled;
  } catch {
    return false;
  }
}

/** Installed check (when permitted), then the real message handshake with the Client. */
export async function checkClient(id: string): Promise<ClientCheck> {
  if ((await isInstalledAndEnabled(id)) === false) {
    return { status: "error", message: NOT_FOUND_MESSAGE };
  }
  const status = await new ConfiguredServiceWorkerDiagnosticsProvider({
    extensionId: id,
  }).getStatus();
  if (status.status === "ok") return { status: "ok" };
  return {
    status: "not_answering",
    message: status.error ?? "The Apty Client did not answer.",
  };
}
