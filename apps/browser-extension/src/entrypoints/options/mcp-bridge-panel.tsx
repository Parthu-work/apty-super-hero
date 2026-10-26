/**
 * MCP WebSocket Bridge Panel
 * UI for connecting/disconnecting the extension to the apty-mcp-bridge.
 */

import type { WsMcpServerState } from "@apty/browser-runtime";
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
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import { Cable, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const DEFAULT_URL = "ws://localhost:9223";

type ConnectionStatus = WsMcpServerState["status"];

const STATUS_LABEL: Record<ConnectionStatus, TranslationKey> = {
  disconnected: "mcpBridge.status.disconnected",
  connecting: "mcpBridge.status.connecting",
  connected: "mcpBridge.status.connected",
  error: "mcpBridge.status.error",
};

const STATUS_BADGE_CLASSES: Record<ConnectionStatus, string> = {
  disconnected: "border-border bg-muted text-muted-foreground",
  connecting: "border-warning-border bg-warning-muted text-warning",
  connected: "border-success/30 bg-success-muted text-success",
  error: "border-destructive/30 bg-destructive-muted text-destructive",
};

// Same storage keys @apty/browser-runtime's WsMcpServer persists to —
// duplicated here (not imported) because they're an internal storage
// implementation detail, not part of its public API surface.
const STORAGE_KEY_WS_TOKEN = "ws-mcp-token";

export function McpBridgePanel() {
  const { t } = useTranslation();
  const [url, setUrl] = useState(DEFAULT_URL);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const refreshStatus = useCallback(async () => {
    try {
      const state = await chrome.runtime.sendMessage({
        request: "ws-bridge-status",
      });
      if (state) {
        setStatus(state.status);
        setError(state.error);
        setConnectedAt(state.connectedAt);
        setReconnectAttempt(state.reconnectAttempt);
        if (state.url) setUrl(state.url);
      }
    } catch {
      // Background may not be ready
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 3000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // Pre-fill the saved token directly from storage — deliberately NOT
  // through the "ws-bridge-status" message above, which is also used for
  // the badge/keepalive status and must never carry the token.
  useEffect(() => {
    chrome.storage.local
      .get(STORAGE_KEY_WS_TOKEN)
      .then((result) => {
        const saved = result[STORAGE_KEY_WS_TOKEN];
        if (typeof saved === "string") setToken(saved);
      })
      .catch(() => {
        // Background may not be ready yet
      });
  }, []);

  const handleConnect = async () => {
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        request: "ws-bridge-connect",
        url,
        token,
      });
      if (!response.success) {
        setError(response.error || t("mcpBridge.connectionFailed"));
      }
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDisconnect = async () => {
    try {
      await chrome.runtime.sendMessage({ request: "ws-bridge-disconnect" });
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isBusy = status === "connected" || status === "connecting";

  return (
    <Card id="mcp-bridge" className="scroll-mt-4">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Cable className="h-4 w-4 text-muted-foreground" />
              {t("mcpBridge.title")}
            </CardTitle>
            <CardDescription>{t("mcpBridge.description")}</CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 gap-1.5 border",
              STATUS_BADGE_CLASSES[status],
            )}
          >
            {status === "connecting" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {t(STATUS_LABEL[status])}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "connected" && connectedAt && (
          <p className="text-xs text-muted-foreground">
            {t("mcpBridge.connectedSince", {
              time: new Date(connectedAt).toLocaleTimeString(),
            })}
          </p>
        )}
        {status !== "connected" && reconnectAttempt > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("mcpBridge.reconnectAttempt", { count: reconnectAttempt })}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="mcp-bridge-url">{t("mcpBridge.url")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="mcp-bridge-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={DEFAULT_URL}
              disabled={isBusy}
              className="flex-1"
            />
            {status === "connected" ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDisconnect}
              >
                {t("aptyPeer.disconnect")}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleConnect}
                disabled={
                  status === "connecting" || !url.trim() || !token.trim()
                }
              >
                {status === "connecting" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t(
                  status === "connecting"
                    ? "aptyPeer.connecting"
                    : "aptyPeer.connect",
                )}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("mcpBridge.localhostOnly")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mcp-bridge-token">{t("mcpBridge.token")}</Label>
          <Input
            id="mcp-bridge-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t("mcpBridge.tokenPlaceholder")}
            disabled={isBusy}
          />
          <p className="text-xs text-muted-foreground">
            {t("mcpBridge.tokenHintBefore")}{" "}
            <code>node apps/mcp-bridge/dist/daemon.js --print-token-path</code>{" "}
            {t("mcpBridge.tokenHintAfter")}
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          {t("mcpBridge.exposesBefore")} <code>tools/list</code>{" "}
          {t("mcpBridge.exposesAnd")} <code>tools/call</code>{" "}
          {t("mcpBridge.exposesAfter")}
        </p>
      </CardContent>
    </Card>
  );
}
