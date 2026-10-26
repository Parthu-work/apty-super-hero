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
import { StatusBadge } from "@apty/ui/components/ui/badge";
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
import { CheckCircle2, Info, Loader2, Plug, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type ClientCheck,
  checkPeer,
  connectPeer,
} from "../../services/apty-client-check";
import { requestOptionalPermission } from "../../services/optional-permissions";
import { ClientNetworkCallsPanel } from "./client-network-calls-panel";

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
    title: TranslationKey;
    description: TranslationKey;
    name: string;
    inputId: string;
    inputLabel: TranslationKey;
    placeholder: TranslationKey;
    notConnected: TranslationKey;
    noneDetected: TranslationKey;
    usage: TranslationKey;
  }
> = {
  client: {
    cardId: "apty-client",
    title: "aptyPeer.client.title",
    description: "aptyPeer.client.description",
    name: "Apty Client",
    inputId: "apty-client-extension-id",
    inputLabel: "aptyPeer.client.inputLabel",
    placeholder: "aptyPeer.client.placeholder",
    notConnected: "aptyPeer.client.notConnected",
    noneDetected: "aptyPeer.client.noneDetected",
    usage: "aptyPeer.client.usage",
  },
  studio: {
    cardId: "apty-studio",
    title: "aptyPeer.studio.title",
    description: "aptyPeer.studio.description",
    name: "Apty Studio",
    inputId: "apty-studio-extension-id",
    inputLabel: "aptyPeer.studio.inputLabel",
    placeholder: "aptyPeer.studio.placeholder",
    notConnected: "aptyPeer.studio.notConnected",
    noneDetected: "aptyPeer.studio.noneDetected",
    usage: "aptyPeer.studio.usage",
  },
};

export function AptyClientPanel() {
  return <AptyPeerPanel peer="client" />;
}

export function AptyStudioPanel() {
  return <AptyPeerPanel peer="studio" />;
}

/** The snippet the peer's manifest needs, with this Agent's ID filled in. */
function allowListSnippet(agentId: string): string {
  return `"externally_connectable": { "ids": ["${agentId}"] }`;
}

/** Copies `value`, and says so once it has. */
function CopyButton({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
    >
      {t(copied ? "common.copied" : "common.copy")}
    </Button>
  );
}

/** A read-only value with a Copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
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
      <CopyButton
        label={t("aptyPeer.copyLabel", {
          label: `${label.charAt(0).toLowerCase()}${label.slice(1)}`,
        })}
        value={value}
      />
    </div>
  );
}

function AptyPeerPanel({ peer }: { peer: AptyPeer }) {
  const { t } = useTranslation();
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
        message: t("aptyPeer.invalidId", { name: copy.name }),
      });
      return;
    }
    setCheck({ status: "checking" });
    const result = await connectPeer(peer, id);
    setCheck(result);
    if (result.status !== "error") setSaved(id);
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
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-muted-foreground" />
              {t(copy.title)}
            </CardTitle>
            <CardDescription>{t(copy.description)}</CardDescription>
          </div>
          <StatusBadge
            tone={isConnected ? "success" : "neutral"}
            icon={isConnected ? CheckCircle2 : XCircle}
            indicator="icon"
          >
            {t(
              check.status === "ok"
                ? "aptyPeer.answering"
                : isConnected
                  ? "aptyPeer.configuredBadge"
                  : "aptyPeer.notConnectedBadge",
            )}
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected ? (
          <Alert className="border-success/30 bg-success-muted">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <AlertDescription>
              <p className="text-foreground">
                {t("aptyPeer.configured", { name: copy.name })}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  ({saved})
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  check.status === "ok"
                    ? "aptyPeer.answered"
                    : "aptyPeer.savedTest",
                  { name: copy.name },
                )}
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-border bg-muted/40">
            <Info className="h-4 w-4 text-muted-foreground" />
            <AlertDescription className="text-muted-foreground">
              {t(copy.notConnected)}{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                chrome://extensions
              </code>{" "}
              {t("aptyPeer.notConnectedSuffix")}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor={copy.inputId}>{t(copy.inputLabel)}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={copy.inputId}
              type="text"
              value={extensionId}
              onChange={(e) => setExtensionId(e.target.value.trim())}
              placeholder={t(copy.placeholder)}
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
                  {t("aptyPeer.testConnection")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDisconnect}
                >
                  {t("aptyPeer.disconnect")}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={handleDetect}>
                  {t("aptyPeer.detect")}
                </Button>
                <Button
                  type="button"
                  onClick={handleConnect}
                  disabled={isChecking || !extensionId.trim()}
                >
                  {isChecking && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t(isChecking ? "aptyPeer.connecting" : "aptyPeer.connect")}
                </Button>
              </>
            )}
          </div>
          {detected && detected.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t(copy.noneDetected)}
            </p>
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
                    {t("aptyPeer.use", { name: ext.name })}{" "}
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
                <p className="font-medium">{t("aptyPeer.notAnswering")}</p>
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
                {t("aptyPeer.ownId", { name: copy.name })}{" "}
                <code className="select-all rounded bg-muted px-1 py-0.5 font-mono">
                  {ownId}
                </code>{" "}
                <CopyButton label={t("aptyPeer.copyOwnId")} value={ownId} />
              </p>
            ) : (
              <CopyField
                label={t("aptyPeer.ownIdField", { name: copy.name })}
                value={ownId}
              />
            )}
            <CopyField
              label={t("aptyPeer.manifestSnippet", { name: copy.name })}
              value={allowListSnippet(ownId)}
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t(copy.usage)}</p>

        {peer === "client" && <ClientNetworkCallsPanel extensionId={saved} />}
      </CardContent>
    </Card>
  );
}
