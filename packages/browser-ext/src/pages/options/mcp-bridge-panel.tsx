/**
 * MCP WebSocket Bridge Panel
 * UI for connecting/disconnecting the extension to the aipex-mcp-bridge.
 */

import {
  Alert,
  AlertDescription,
} from "@aipexstudio/aipex-react/components/ui/alert";
import { Badge } from "@aipexstudio/aipex-react/components/ui/badge";
import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@aipexstudio/aipex-react/components/ui/card";
import { Input } from "@aipexstudio/aipex-react/components/ui/input";
import { Label } from "@aipexstudio/aipex-react/components/ui/label";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import type { WsMcpServerState } from "@aipexstudio/browser-runtime";
import { Cable, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const DEFAULT_URL = "ws://localhost:9223";

type ConnectionStatus = WsMcpServerState["status"];

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  disconnected: "Not Connected",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Connection Error",
};

const STATUS_BADGE_CLASSES: Record<ConnectionStatus, string> = {
  disconnected: "border-border bg-muted text-muted-foreground",
  connecting: "border-warning/30 bg-warning/10 text-warning",
  connected: "border-success/30 bg-success/10 text-success",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function McpBridgePanel() {
  const [url, setUrl] = useState(DEFAULT_URL);
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

  const handleConnect = async () => {
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        request: "ws-bridge-connect",
        url,
      });
      if (!response.success) {
        setError(response.error || "Connection failed");
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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cable className="h-4 w-4 text-muted-foreground" />
              MCP WebSocket Bridge
            </CardTitle>
            <CardDescription>
              Connect to an external MCP client (e.g. Claude, Cursor) to expose
              Apty Agent's browser tools to external AI agents.
            </CardDescription>
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
            {STATUS_LABEL[status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "connected" && connectedAt && (
          <p className="text-xs text-muted-foreground">
            Connected since {new Date(connectedAt).toLocaleTimeString()}
          </p>
        )}
        {status !== "connected" && reconnectAttempt > 0 && (
          <p className="text-xs text-muted-foreground">
            Reconnect attempt {reconnectAttempt}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="mcp-bridge-url">Bridge URL</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="mcp-bridge-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="ws://localhost:9223"
              disabled={isBusy}
              className="flex-1"
            />
            {status === "connected" ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDisconnect}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleConnect}
                disabled={status === "connecting" || !url.trim()}
              >
                {status === "connecting" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {status === "connecting" ? "Connecting..." : "Connect"}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Only localhost connections (127.0.0.1, ::1) are allowed.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          The bridge exposes <code>tools/list</code> and <code>tools/call</code>{" "}
          over the MCP protocol, allowing external agents to use Apty Agent's
          browser automation tools.
        </p>
      </CardContent>
    </Card>
  );
}
