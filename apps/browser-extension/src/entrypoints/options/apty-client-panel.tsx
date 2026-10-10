/**
 * Apty Client and Apty Studio connection panels (one component, `peer`
 * picks the copy and where the ID is stored; see browser-runtime's
 * `apty/peers.ts`).
 *
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
import {
  type AptyPeer,
  peerExtensionId,
  peerExtensionIdPatch,
} from "@apty/browser-runtime/apty/peers";
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
import { type ClientCheck, checkPeer } from "../../services/apty-client-check";
import { requestOptionalPermission } from "../../services/optional-permissions";

type CheckState = { status: "idle" } | { status: "checking" } | ClientCheck;

interface DetectedExtension {
  id: string;
  name: string;
}

/** Enabled extensions whose name mentions Apty, other than this Agent. */
async function findAptyExtensions(
  ownId: string | undefined,
): Promise<DetectedExtension[]> {
  try {
    const all = await chrome.management.getAll();
    return all
      .filter(
        (ext) =>
          ext.type === "extension" &&
          ext.enabled &&
          ext.id !== ownId &&
          /apty/i.test(ext.name),
      )
      .map(({ id, name }) => ({ id, name }));
  } catch {
    return [];
  }
}

const COPY: Record<
  AptyPeer,
  {
    cardId: string;
    title: string;
    description: string;
    name: string;
    inputId: string;
    inputLabel: string;
    placeholder: string;
    notConnected: string;
    noneDetected: string;
    usage: string;
  }
> = {
  client: {
    cardId: "apty-client",
    title: "Apty Client Extension",
    description:
      'Lets the agent ask the Apty Client directly for its resources — e.g. "Get segments.json" — without repeating the extension ID in every chat message.',
    name: "Apty Client",
    inputId: "apty-client-extension-id",
    inputLabel: "Extension ID",
    placeholder: "Apty Client extension ID (32 characters)",
    notConnected:
      "Not connected yet. Paste the Apty Client's 32-character Chrome extension ID below (find it at",
    noneDetected:
      "No installed extension named like the Apty Client was found (or permission to list extensions was declined). Paste its ID instead.",
    usage:
      'Once configured, ask the agent things like "Get segments.json", "Show me app.json", or "What resources did the Apty Client load?" — no need to repeat the extension ID.',
  },
  studio: {
    cardId: "apty-studio",
    title: "Apty Studio Extension",
    description:
      "Lets the agent read Apty Studio's service-worker status and logs. Studio must first list this Agent's ID in its manifest (docs/integrations/apty/STUDIO.md).",
    name: "Apty Studio",
    inputId: "apty-studio-extension-id",
    inputLabel: "Apty Studio's Chrome ID",
    placeholder: "Apty Studio extension ID (32 characters)",
    notConnected:
      "Not connected yet. Paste Apty Studio's 32-character Chrome extension ID below (find it at",
    noneDetected:
      "No installed extension named like Apty Studio was found (or permission to list extensions was declined). Paste its ID instead.",
    usage:
      'Once configured, ask the agent "Show Apty Studio\'s service worker logs".',
  },
};

export function AptyClientPanel() {
  return <AptyPeerPanel peer="client" />;
}

export function AptyStudioPanel() {
  return <AptyPeerPanel peer="studio" />;
}

/** The snippet the peer's manifest needs, with this Agent's ID filled in. */
export function allowListSnippet(agentId: string): string {
  return `"externally_connectable": { "ids": ["${agentId}"] }`;
}

/** A read-only value with a Copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        aria-label={label}
        title={label}
        value={value}
        className="h-8 flex-1 font-mono text-xs"
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Copy ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function AptyPeerPanel({ peer }: { peer: AptyPeer }) {
  const copy = COPY[peer];
  const [extensionId, setExtensionId] = useState("");
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [detected, setDetected] = useState<DetectedExtension[] | undefined>();
  const ownId = chrome.runtime?.id;

  useEffect(() => {
    getAptyIntegrationConfig().then((config: AptyIntegrationConfig) => {
      const id = peerExtensionId(config, peer);
      if (id) {
        setExtensionId(id);
        setSaved(id);
      }
    });
  }, [peer]);

  const runCheck = async (id: string) => {
    setCheck({ status: "checking" });
    const result = await checkPeer(peer, id);
    setCheck(result);
    return result;
  };

  const handleConnect = async () => {
    const id = extensionId.trim();
    if (!isValidExtensionId(id)) {
      setCheck({
        status: "error",
        message: `Invalid Chrome extension ID. Please provide a valid ${copy.name} extension ID (32 lowercase a-p characters).`,
      });
      return;
    }
    const result = await runCheck(id);
    if (result.status === "error") return;
    await updateAptyIntegrationConfig(
      peerExtensionIdPatch(await getAptyIntegrationConfig(), peer, id),
    );
    setSaved(id);
  };

  const handleDetect = async () => {
    setDetected(undefined);
    if (!(await requestOptionalPermission("management"))) {
      setDetected([]);
      return;
    }
    setDetected(await findAptyExtensions(ownId));
  };

  const handleDisconnect = async () => {
    await updateAptyIntegrationConfig(
      peerExtensionIdPatch(await getAptyIntegrationConfig(), peer, undefined),
    );
    setSaved(undefined);
    setCheck({ status: "idle" });
  };

  const isConnected = Boolean(saved) && check.status !== "not_answering";
  const isChecking = check.status === "checking";

  return (
    <Card id={copy.cardId} className="scroll-mt-4">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="h-4 w-4 text-muted-foreground" />
              {copy.title}
            </CardTitle>
            <CardDescription>{copy.description}</CardDescription>
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
                {copy.name} configured{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  ({saved})
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {check.status === "ok"
                  ? `The ${copy.name} answered the Agent's handshake.`
                  : `Saved. Use Test connection to confirm the ${copy.name} answers.`}
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-border bg-muted/40">
            <Info className="h-4 w-4 text-muted-foreground" />
            <AlertDescription className="text-muted-foreground">
              {copy.notConnected}{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                chrome://extensions
              </code>{" "}
              with Developer mode on) and click Connect.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor={copy.inputId}>{copy.inputLabel}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={copy.inputId}
              type="text"
              value={extensionId}
              onChange={(e) => setExtensionId(e.target.value.trim())}
              placeholder={copy.placeholder}
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
              <>
                <Button type="button" variant="outline" onClick={handleDetect}>
                  Detect
                </Button>
                <Button
                  type="button"
                  onClick={handleConnect}
                  disabled={isChecking || !extensionId.trim()}
                >
                  {isChecking && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isChecking ? "Connecting..." : "Connect"}
                </Button>
              </>
            )}
          </div>
          {detected && detected.length === 0 && (
            <p className="text-xs text-muted-foreground">{copy.noneDetected}</p>
          )}
          {detected && detected.length > 0 && (
            <ul className="space-y-1">
              {detected.map((ext) => (
                <li key={ext.id}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setExtensionId(ext.id)}
                  >
                    Use {ext.name}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {ext.id}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
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
              {check.status === "not_answering" && check.fix && (
                <p className="mt-1 font-medium">{check.fix}</p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {ownId && (
          <div className="space-y-1">
            {peer === "client" ? (
              <p className="text-xs text-muted-foreground">
                This Agent's extension ID (the {copy.name} must allow-list it):{" "}
                <code className="select-all rounded bg-muted px-1 py-0.5 font-mono">
                  {ownId}
                </code>
              </p>
            ) : (
              <CopyField
                label={`This Agent's ID, which ${copy.name} must allow-list`}
                value={ownId}
              />
            )}
            <CopyField
              label={`The ${copy.name} manifest snippet`}
              value={allowListSnippet(ownId)}
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">{copy.usage}</p>
      </CardContent>
    </Card>
  );
}
