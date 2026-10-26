import {
  type AptyPeer,
  isValidExtensionId,
} from "@apty/browser-runtime/apty/peers";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { Input } from "@apty/ui/components/ui/input";
import { Notice } from "@apty/ui/components/ui/notice";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { openOptions } from "../../lib/open-options";
import type { ClientCheck } from "../../services/apty-client-check";
import { useNavigation } from "../../state/navigation-store";
import { type PeerStatus, peerStore } from "../../state/readiness-store";
import type { CurrentTarget } from "../investigation/use-current-target";
import { ToolPageShell } from "../shell/tool-page-shell";
import { SetupBadge } from "./setup-badge";
import { useReadiness } from "./use-readiness";

function ConnectionCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-title font-semibold text-foreground">
          {title}
        </h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function ProviderCard({ model }: { model: string | undefined }) {
  const { t } = useTranslation();
  const ready = model !== undefined;
  const openProvider = () => void openOptions({ section: "ai-provider" });
  return (
    <ConnectionCard
      title={t("readiness.provider.label")}
      badge={
        <StatusBadge tone={ready ? "success" : "warning"}>
          {t(ready ? "connections.ready" : "connections.needsSetup")}
        </StatusBadge>
      }
    >
      <p className="text-sm text-muted-foreground">
        {t("connections.providerBody")}
      </p>
      {ready ? (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-small text-muted-foreground">
            {t("readiness.provider.using", { model })}
          </p>
          <Button variant="secondary" onClick={openProvider}>
            {t("connections.change")}
          </Button>
        </div>
      ) : (
        <Button className="w-full" onClick={openProvider}>
          {t("setupNeeded.setUp")}
        </Button>
      )}
    </ConnectionCard>
  );
}

const PEER_COPY: Record<
  AptyPeer,
  {
    title: TranslationKey;
    body: TranslationKey;
    placeholder: TranslationKey;
    allowList: TranslationKey;
    connect: TranslationKey;
  }
> = {
  client: {
    title: "readiness.client.label",
    body: "connections.clientBody",
    placeholder: "connections.clientPlaceholder",
    allowList: "connections.clientAllowList",
    connect: "connections.clientConnect",
  },
  studio: {
    title: "connections.studioTitle",
    body: "connections.studioBody",
    placeholder: "connections.studioPlaceholder",
    allowList: "connections.studioAllowList",
    connect: "connections.studioConnect",
  },
};

function PeerBadge({ status }: { status: PeerStatus }) {
  const { t } = useTranslation();
  switch (status.kind) {
    case "checking":
      return (
        <StatusBadge tone="info" indicator="spinner">
          {t("readiness.state.checking")}
        </StatusBadge>
      );
    case "not-configured":
      return (
        <StatusBadge tone="neutral">
          {t("connections.notConnected")}
        </StatusBadge>
      );
    case "connected":
      return (
        <StatusBadge tone="success">{t("connections.connected")}</StatusBadge>
      );
    case "not-answering":
      return (
        <StatusBadge tone="warning">
          {t("connections.notAnswering")}
        </StatusBadge>
      );
  }
}

function CopyIdButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t(copied ? "common.copied" : "connections.copyId")}
      title={t("connections.copyId")}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function PeerCard({ peer, status }: { peer: AptyPeer; status: PeerStatus }) {
  const { t } = useTranslation();
  const copy = PEER_COPY[peer];
  const inputId = useId();
  const errorId = useId();
  const allowListId = useId();
  const savedId =
    status.kind === "connected" || status.kind === "not-answering"
      ? status.extensionId
      : "";
  const [value, setValue] = useState(savedId);
  const [invalid, setInvalid] = useState(false);
  const [result, setResult] = useState<ClientCheck | null>(null);
  const ownId = chrome.runtime?.id ?? "";

  useEffect(() => setValue(savedId), [savedId]);

  const connect = async () => {
    const id = value.trim();
    if (!isValidExtensionId(id)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setResult(await peerStore.connect(peer, id));
  };

  const failure =
    result?.status === "error"
      ? { tone: "error" as const, text: result.message }
      : status.kind === "not-answering"
        ? {
            tone: "warning" as const,
            text: status.message || t("readiness.client.notCheckedDetail"),
          }
        : null;

  return (
    <ConnectionCard title={t(copy.title)} badge={<PeerBadge status={status} />}>
      <p className="text-sm text-muted-foreground">{t(copy.body)}</p>
      <form
        className="space-y-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <div className="space-y-1.5">
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-foreground"
          >
            {t("aptyPeer.client.inputLabel")}
          </label>
          <Input
            id={inputId}
            value={value}
            placeholder={t(copy.placeholder)}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className="font-mono text-xs"
            onChange={(event) => {
              setValue(event.target.value);
              setInvalid(false);
              setResult(null);
            }}
          />
          {invalid && (
            <p id={errorId} className="text-small text-destructive">
              {t("connections.invalidId")}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={allowListId}
            className="block text-sm font-medium text-foreground"
          >
            {t(copy.allowList)}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={allowListId}
              readOnly
              value={ownId}
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyIdButton value={ownId} />
          </div>
        </div>
        {failure && <Notice tone={failure.tone}>{failure.text}</Notice>}
        <Button
          type="submit"
          className="w-full"
          disabled={status.kind === "checking"}
        >
          {t(copy.connect)}
        </Button>
      </form>
    </ConnectionCard>
  );
}

function SiteCard({ target }: { target: CurrentTarget }) {
  const { t } = useTranslation();
  return (
    <ConnectionCard
      title={t("connections.siteTitle")}
      badge={
        target.checking ? (
          <StatusBadge tone="info" indicator="spinner">
            {t("readiness.state.checking")}
          </StatusBadge>
        ) : (
          <StatusBadge tone={target.inspectable ? "success" : "warning"}>
            {t(target.inspectable ? "shell.canInspect" : "shell.cantInspect")}
          </StatusBadge>
        )
      }
    >
      <p className="truncate text-sm font-medium text-foreground">
        {target.hostname ?? t("shell.noPage")}
      </p>
      {!target.checking && (
        <p className="text-small text-muted-foreground">{target.detail}</p>
      )}
    </ConnectionCard>
  );
}

/**
 * Connections: the AI provider, the Apty Client and Studio, and whether
 * this page can be inspected. Client and Studio connect here with the same
 * check and save as Options.
 */
export function ConnectionsPage() {
  const { t } = useTranslation();
  const { states, setupCount, peers, target, model } = useReadiness();
  const { page } = useNavigation();

  useEffect(() => {
    if (page === "connections") void peerStore.refresh();
  }, [page]);

  return (
    <ToolPageShell
      title={t("shell.connections")}
      trailing={<SetupBadge count={setupCount} className="mr-2" />}
    >
      <div className="space-y-4">
        {states.provider === "warning" && (
          <p className="text-sm text-muted-foreground">
            {t("connections.providerFirst")}
          </p>
        )}
        <ProviderCard model={model} />
        <PeerCard peer="client" status={peers.client} />
        <PeerCard peer="studio" status={peers.studio} />
        <SiteCard target={target} />
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => void openOptions({ section: "apty-client" })}
        >
          {t("connections.openAll")}
        </Button>
      </div>
    </ToolPageShell>
  );
}
