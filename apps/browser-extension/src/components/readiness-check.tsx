/**
 * What an investigation needs before it starts: a configured AI provider,
 * a reachable Apty Client (only for Client logs and requests), and a page
 * the extension is allowed to inspect. Each row says what to do next.
 */
import type { AppSettings } from "@apty/agent-core";
import { getAptyIntegrationConfig } from "@apty/browser-runtime";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  Loader2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { type OptionsSection, openOptions } from "../lib/open-options";
import { isProviderConfigured } from "../services/ai-provider";
import { checkClient } from "../services/apty-client-check";
import type { Translate } from "../services/model-list";
import { describePage } from "../services/page-access";

type RowState = "ok" | "warning" | "info" | "checking";

interface Row {
  label: string;
  /** Chip text. */
  summary: string;
  state: RowState;
  detail: string;
  action?: { label: string; section: OptionsSection };
}

function useActiveTabUrl(): string | undefined | null {
  const [url, setUrl] = useState<string | undefined | null>(null);
  useEffect(() => {
    const refresh = () => {
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => setUrl(tab?.url))
        .catch(() => setUrl(undefined));
    };
    const onUpdated = (
      _tabId: number,
      change: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (tab.active && (change.url || change.status === "complete")) refresh();
    };
    refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return url;
}

function useClientRow(t: Translate): Row {
  const label = t("readiness.client.label");
  const [row, setRow] = useState<Row>({
    label,
    summary: label,
    state: "checking",
    detail: t("readiness.client.checking"),
  });
  useEffect(() => {
    let cancelled = false;
    const clientLabel = t("readiness.client.label");
    (async () => {
      const { clientExtensionId } = await getAptyIntegrationConfig();
      if (!clientExtensionId) {
        return {
          label: clientLabel,
          summary: t("readiness.client.notConnected"),
          state: "info",
          detail: t("readiness.client.notConnectedDetail"),
          action: {
            label: t("readiness.client.connect"),
            section: "apty-client",
          },
        } satisfies Row;
      }
      const check = await checkClient(clientExtensionId);
      if (check.status === "ok") {
        return {
          label: clientLabel,
          summary: t("readiness.client.connected"),
          state: "ok",
          detail: t("readiness.client.connectedDetail"),
        } satisfies Row;
      }
      return {
        label: clientLabel,
        summary: t("readiness.client.notAnswering"),
        state: "warning",
        detail: check.message,
        action: { label: t("readiness.fix"), section: "apty-client" },
      } satisfies Row;
    })()
      .then((next) => {
        if (!cancelled) setRow(next);
      })
      .catch(() => {
        if (!cancelled) {
          setRow({
            label: clientLabel,
            summary: t("readiness.client.notChecked"),
            state: "warning",
            detail: t("readiness.client.notCheckedDetail"),
            action: { label: t("readiness.fix"), section: "apty-client" },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);
  return row;
}

const STATE_ICON: Record<RowState, ReactNode> = {
  ok: <CheckCircle2Icon aria-hidden="true" className="size-3.5 text-success" />,
  warning: (
    <AlertTriangleIcon aria-hidden="true" className="size-3.5 text-warning" />
  ),
  info: (
    <InfoIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
  ),
  checking: (
    <Loader2Icon
      aria-hidden="true"
      className="size-3.5 animate-spin text-muted-foreground"
    />
  ),
};

const STATE_LABEL: Record<RowState, TranslationKey> = {
  ok: "readiness.state.ok",
  warning: "readiness.state.warning",
  info: "readiness.state.info",
  checking: "readiness.state.checking",
};

function hostOf(url: string | undefined, t: Translate): string {
  try {
    return url ? new URL(url).hostname || t("readiness.localFile") : "";
  } catch {
    return "";
  }
}

function useFileAccessAllowed(): boolean {
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    chrome.extension
      ?.isAllowedFileSchemeAccess?.()
      .then(setAllowed)
      .catch(() => {});
  }, []);
  return allowed;
}

export function ReadinessCheck({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation();
  const url = useActiveTabUrl();
  const client = useClientRow(t);
  const fileAccessAllowed = useFileAccessAllowed();
  const page = url === null ? null : describePage(url, fileAccessAllowed, t);
  const providerLabel = t("readiness.provider.label");
  const pageLabel = t("readiness.page.label");

  const rows: Row[] = [
    isProviderConfigured(settings)
      ? {
          label: providerLabel,
          summary: settings.aiModel ?? providerLabel,
          state: "ok",
          detail: t("readiness.provider.using", {
            model: settings.aiModel ?? "",
          }),
        }
      : {
          label: providerLabel,
          summary: t("readiness.provider.setUpSummary"),
          state: "warning",
          detail: t("readiness.provider.setUpDetail"),
          action: {
            label: t("readiness.provider.setUp"),
            section: "ai-provider",
          },
        },
    client,
    page === null
      ? {
          label: pageLabel,
          summary: pageLabel,
          state: "checking",
          detail: t("readiness.page.checking"),
        }
      : {
          label: pageLabel,
          summary: page.inspectable
            ? hostOf(url ?? undefined, t)
            : t("readiness.page.notInspectable"),
          state: page.inspectable ? "ok" : "warning",
          detail: page.detail,
        },
  ];
  const warnings = rows.filter((row) => row.state === "warning");

  return (
    <section aria-label={t("readiness.label")} className="w-full max-w-2xl">
      <ul className="flex flex-wrap justify-center gap-1.5">
        {rows.map((row) => {
          const content = (
            <>
              {STATE_ICON[row.state]}
              <span className="sr-only">
                {row.label}, {t(STATE_LABEL[row.state])}:
              </span>
              <span className="max-w-[16rem] truncate">{row.summary}</span>
            </>
          );
          const chipClass = cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
            row.state === "warning"
              ? "border-warning-border bg-warning-muted text-foreground"
              : "bg-card text-muted-foreground",
          );
          return (
            <li key={row.label}>
              {row.action ? (
                <button
                  type="button"
                  title={row.detail}
                  className={cn(chipClass, "hover:bg-accent")}
                  onClick={() => {
                    void openOptions({ section: row.action?.section });
                  }}
                >
                  {content}
                </button>
              ) : (
                <span title={row.detail} className={chipClass}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {warnings.map((row) => (
        <p
          key={row.label}
          className="mt-2 flex flex-wrap items-center justify-center gap-x-2 text-center text-xs text-muted-foreground"
        >
          <span>{row.detail}</span>
          {row.action && (
            <Button
              type="button"
              size="sm"
              variant="link"
              className="h-auto p-0 text-xs"
              onClick={() => {
                void openOptions({ section: row.action?.section });
              }}
            >
              {row.action.label}
            </Button>
          )}
        </p>
      ))}
    </section>
  );
}
