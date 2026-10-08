/**
 * What an investigation needs before it starts: a configured AI provider,
 * a reachable Apty Client (only for Client logs and requests), and a page
 * the extension is allowed to inspect. Each row says what to do next.
 */
import type { AppSettings } from "@apty/agent-core";
import { getAptyIntegrationConfig } from "@apty/browser-runtime";
import { Button } from "@apty/ui/components/ui/button";
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

type RowState = "ok" | "warning" | "info" | "checking";

interface Row {
  label: string;
  /** Chip text. */
  summary: string;
  state: RowState;
  detail: string;
  action?: { label: string; section: OptionsSection };
}

const INSPECTABLE_PROTOCOLS = new Set(["http:", "https:", "file:"]);
const STORE_HOSTS = new Set(["chromewebstore.google.com", "chrome.google.com"]);

/** Whether Chrome lets an extension read and act on the page at `url`. */
export function describePage(url: string | undefined): {
  inspectable: boolean;
  detail: string;
} {
  if (!url) {
    return {
      inspectable: false,
      detail: "No page is open in this window.",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { inspectable: false, detail: "This page's address can't be read." };
  }
  if (
    !INSPECTABLE_PROTOCOLS.has(parsed.protocol) ||
    STORE_HOSTS.has(parsed.hostname)
  ) {
    return {
      inspectable: false,
      detail: `Chrome doesn't let extensions inspect ${parsed.protocol === "https:" ? parsed.hostname : `${parsed.protocol.replace(":", "")}:`} pages. Open the page you want to investigate.`,
    };
  }
  return {
    inspectable: true,
    detail:
      parsed.protocol === "file:"
        ? "Ready to inspect this local file."
        : `Ready to inspect ${parsed.hostname}.`,
  };
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

function useClientRow(): Row {
  const [row, setRow] = useState<Row>({
    label: "Apty Client",
    summary: "Apty Client",
    state: "checking",
    detail: "Checking the connection…",
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { clientExtensionId } = await getAptyIntegrationConfig();
      if (!clientExtensionId) {
        return {
          label: "Apty Client",
          summary: "Apty Client not connected",
          state: "info",
          detail:
            "Not connected. Only needed to read the Client's service-worker logs and requests.",
          action: { label: "Connect", section: "apty-client" },
        } satisfies Row;
      }
      const check = await checkClient(clientExtensionId);
      if (check.status === "ok") {
        return {
          label: "Apty Client",
          summary: "Apty Client connected",
          state: "ok",
          detail: "Connected.",
        } satisfies Row;
      }
      return {
        label: "Apty Client",
        summary: "Apty Client not answering",
        state: "warning",
        detail: check.message,
        action: { label: "Fix", section: "apty-client" },
      } satisfies Row;
    })()
      .then((next) => {
        if (!cancelled) setRow(next);
      })
      .catch(() => {
        if (!cancelled) {
          setRow({
            label: "Apty Client",
            summary: "Apty Client not checked",
            state: "warning",
            detail: "The connection couldn't be checked.",
            action: { label: "Fix", section: "apty-client" },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
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

const STATE_LABEL: Record<RowState, string> = {
  ok: "Ready",
  warning: "Needs attention",
  info: "Optional",
  checking: "Checking",
};

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname || "local file" : "";
  } catch {
    return "";
  }
}

export function ReadinessCheck({ settings }: { settings: AppSettings }) {
  const url = useActiveTabUrl();
  const client = useClientRow();
  const page = url === null ? null : describePage(url);

  const rows: Row[] = [
    isProviderConfigured(settings)
      ? {
          label: "AI provider",
          summary: settings.aiModel ?? "AI provider",
          state: "ok",
          detail: `Using ${settings.aiModel}.`,
        }
      : {
          label: "AI provider",
          summary: "Set up an AI provider",
          state: "warning",
          detail: "Add your own API key and choose a model to start.",
          action: { label: "Set up", section: "ai-provider" },
        },
    client,
    page === null
      ? {
          label: "This page",
          summary: "This page",
          state: "checking",
          detail: "Checking…",
        }
      : {
          label: "This page",
          summary: page.inspectable
            ? hostOf(url ?? undefined)
            : "Page can't be inspected",
          state: page.inspectable ? "ok" : "warning",
          detail: page.detail,
        },
  ];
  const warnings = rows.filter((row) => row.state === "warning");

  return (
    <section aria-label="Readiness check" className="w-full max-w-2xl">
      <ul className="flex flex-wrap justify-center gap-1.5">
        {rows.map((row) => {
          const content = (
            <>
              {STATE_ICON[row.state]}
              <span className="sr-only">
                {row.label}, {STATE_LABEL[row.state]}:
              </span>
              <span className="max-w-[16rem] truncate">{row.summary}</span>
            </>
          );
          const chipClass = cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
            row.state === "warning"
              ? "border-warning/40 bg-warning/10 text-foreground"
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
