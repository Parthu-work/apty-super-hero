/**
 * Apty Client Extension connection panel.
 *
 * V1 resource-agnostic Service Worker inspection (see
 * `packages/browser-runtime/src/apty/extension-network-inspector.ts`) needs
 * the Apty Client's Chrome extension ID. This panel lets the user configure
 * it once instead of repeating it in every chat message — the actual
 * debugger attach/Network capture happens lazily, in the background service
 * worker, the first time a chat tool call needs it (see
 * `../../../browser-runtime/src/tools/extension-network.ts`); this panel
 * only persists the ID and gives early feedback that it resolves to a real,
 * enabled extension via `chrome.management.get`, which any extension page
 * can call.
 */
import {
  type AptyIntegrationConfig,
  getAptyIntegrationConfig,
  isValidExtensionId,
  setAptyIntegrationConfig,
} from "@aipexstudio/browser-runtime";
import { useEffect, useState } from "react";

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; name: string }
  | { status: "error"; message: string };

export function AptyClientPanel() {
  const [extensionId, setExtensionId] = useState("");
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  useEffect(() => {
    getAptyIntegrationConfig().then((config: AptyIntegrationConfig) => {
      if (config.clientExtensionId) {
        setExtensionId(config.clientExtensionId);
        setSaved(config.clientExtensionId);
      }
    });
  }, []);

  const handleConnect = async () => {
    const id = extensionId.trim();
    if (!isValidExtensionId(id)) {
      setCheck({
        status: "error",
        message:
          "Invalid Chrome extension ID. Please provide a valid Apty Client extension ID (32 lowercase a-p characters).",
      });
      return;
    }

    setCheck({ status: "checking" });
    try {
      const info = await chrome.management.get(id);
      if (!info.enabled) {
        setCheck({
          status: "error",
          message:
            "The specified Apty Client extension could not be found or is not currently available.",
        });
        return;
      }
      const config = await getAptyIntegrationConfig();
      await setAptyIntegrationConfig({ ...config, clientExtensionId: id });
      setSaved(id);
      setCheck({ status: "ok", name: info.name });
    } catch {
      setCheck({
        status: "error",
        message:
          "The specified Apty Client extension could not be found or is not currently available.",
      });
    }
  };

  const handleDisconnect = async () => {
    const config = await getAptyIntegrationConfig();
    await setAptyIntegrationConfig({ ...config, clientExtensionId: undefined });
    setSaved(undefined);
    setCheck({ status: "idle" });
  };

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold mb-4">Apty Client Extension</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Configure the Apty Client's Chrome extension ID so the agent can inspect
        its Service Worker Network activity — e.g. "Get segments.json" — without
        you having to provide the ID in every chat message.
      </p>

      {saved && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
          <span className="font-medium">✓ Apty Client connected</span>
          <span className="text-xs text-muted-foreground">({saved})</span>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={extensionId}
          onChange={(e) => setExtensionId(e.target.value.trim())}
          placeholder="Apty Client extension ID (32 characters)"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {saved ? (
          <button
            type="button"
            onClick={handleDisconnect}
            className="inline-flex items-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={check.status === "checking" || !extensionId.trim()}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {check.status === "checking" ? "Connecting..." : "Connect"}
          </button>
        )}
      </div>

      {check.status === "error" && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {check.message}
        </div>
      )}

      <div className="mt-4 text-xs text-muted-foreground space-y-1">
        <p>
          Once configured, ask the agent things like "Get segments.json", "Show
          me app.json", or "What resources did the Apty Client load?" — no need
          to repeat the extension ID.
        </p>
      </div>
    </div>
  );
}
