/**
 * Apty Client Extension connection panel.
 *
 * V1 resource-agnostic resource/log inspection (see
 * `packages/browser-runtime/src/apty/extension-network-inspector.ts`) needs
 * the Apty Client's Chrome extension ID. This panel lets the user configure
 * it once instead of repeating it in every chat message — the actual
 * cross-extension messaging handshake happens lazily, in the background
 * service worker, the first time a chat tool call needs it (see
 * `../../../browser-runtime/src/tools/extension-network.ts`); this panel
 * only persists the ID and gives early feedback that it resolves to a real,
 * enabled extension via `chrome.management.get`, which any extension page
 * can call. That check alone does not confirm the Apty Client actually
 * cooperates with the resource-inspection message contract — the real
 * handshake happens on first use (see connect_apty_client).
 */

import {
  type AptyIntegrationConfig,
  getAptyIntegrationConfig,
  isValidExtensionId,
  updateAptyIntegrationConfig,
} from "@apty/browser-runtime";
import { ConfiguredServiceWorkerDiagnosticsProvider } from "@apty/browser-runtime/apty/service-worker-diagnostics";
import { Alert, AlertDescription } from "@apty/ui/components/ui/alert";
import { Badge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { Input } from "@apty/ui/components/ui/input";
import { Label } from "@apty/ui/components/ui/label";
import { cn } from "@apty/ui/lib/utils";
import { CheckCircle2, Info, Loader2, Plug, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok" }
  | { status: "not_answering"; message: string }
  | { status: "error"; message: string };

const NOT_FOUND_MESSAGE =
  "The specified Apty Client extension could not be found or is not currently available.";

async function isInstalledAndEnabled(id: string): Promise<boolean> {
  try {
    const info = await chrome.management.get(id);
    return info.enabled;
  } catch {
    return false;
  }
}

/** Installed check, then the real message handshake with the Client. */
async function checkClient(id: string): Promise<CheckState> {
  if (!(await isInstalledAndEnabled(id))) {
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

export function AptyClientPanel() {
  const [extensionId, setExtensionId] = useState("");
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const ownId = chrome.runtime?.id;

  useEffect(() => {
    getAptyIntegrationConfig().then((config: AptyIntegrationConfig) => {
      if (config.clientExtensionId) {
        setExtensionId(config.clientExtensionId);
        setSaved(config.clientExtensionId);
      }
    });
  }, []);

  const runCheck = async (id: string) => {
    setCheck({ status: "checking" });
    const result = await checkClient(id);
    setCheck(result);
    return result;
  };

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
    const result = await runCheck(id);
    if (result.status === "error") return;
    await updateAptyIntegrationConfig({ clientExtensionId: id });
    setSaved(id);
  };

  const handleDisconnect = async () => {
    await updateAptyIntegrationConfig({ clientExtensionId: undefined });
    setSaved(undefined);
    setCheck({ status: "idle" });
  };

  const isConnected = Boolean(saved) && check.status !== "not_answering";
  const isChecking = check.status === "checking";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="h-4 w-4 text-muted-foreground" />
              Apty Client Extension
            </CardTitle>
            <CardDescription>
              Lets the agent ask the Apty Client directly for its resources —
              e.g. "Get segments.json" — without repeating the extension ID in
              every chat message.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 gap-1.5 border",
              isConnected
                ? "border-success/30 bg-success/10 text-success"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {isConnected ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            {check.status === "ok"
              ? "Answering"
              : isConnected
                ? "Configured"
                : "Not Connected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected ? (
          <Alert className="border-success/30 bg-success/5">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <AlertDescription>
              <p className="text-foreground">
                Apty Client configured{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  ({saved})
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {check.status === "ok"
                  ? "The Apty Client answered the Agent's handshake."
                  : "Saved. Use Test connection to confirm the Apty Client answers."}
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-border bg-muted/40">
            <Info className="h-4 w-4 text-muted-foreground" />
            <AlertDescription className="text-muted-foreground">
              Not connected yet. Paste the Apty Client's 32-character Chrome
              extension ID below (find it at{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                chrome://extensions
              </code>{" "}
              with Developer mode on) and click Connect.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="apty-client-extension-id">Extension ID</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="apty-client-extension-id"
              type="text"
              value={extensionId}
              onChange={(e) => setExtensionId(e.target.value.trim())}
              placeholder="Apty Client extension ID (32 characters)"
              className="flex-1 font-mono"
            />
            {saved ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => runCheck(saved)}
                  disabled={isChecking}
                >
                  {isChecking && <Loader2 className="h-4 w-4 animate-spin" />}
                  Test connection
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDisconnect}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={handleConnect}
                disabled={isChecking || !extensionId.trim()}
              >
                {isChecking && <Loader2 className="h-4 w-4 animate-spin" />}
                {isChecking ? "Connecting..." : "Connect"}
              </Button>
            )}
          </div>
        </div>

        {(check.status === "error" || check.status === "not_answering") && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              {check.status === "not_answering" && (
                <p className="font-medium">
                  Installed, but not answering the Agent.
                </p>
              )}
              <p>{check.message}</p>
            </AlertDescription>
          </Alert>
        )}

        {ownId && (
          <p className="text-xs text-muted-foreground">
            This Agent's extension ID (the Apty Client must allow-list it):{" "}
            <code className="select-all rounded bg-muted px-1 py-0.5 font-mono">
              {ownId}
            </code>
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Once configured, ask the agent things like "Get segments.json", "Show
          me app.json", or "What resources did the Apty Client load?" — no need
          to repeat the extension ID.
        </p>
      </CardContent>
    </Card>
  );
}
