/**
 * Tracks the browser tab a conversation is actually debugging, for display
 * in the browser context bar (section 8 of the product spec).
 *
 * Reads live tab info via `chrome.tabs`, not evidence — this is "what is
 * the agent looking at right now", independent of whether any diagnostic
 * tool has run yet. Only exposes title + hostname, never the full URL
 * (query strings/paths can carry sensitive data — see redaction guidance
 * elsewhere in this codebase).
 */
import { useTranslation } from "@apty/ui/i18n/context";
import { useEffect, useState } from "react";
import { peekConversationTabBinding } from "../../services/conversation-tab-binding";
import { describePage } from "../../services/page-access";

export interface CurrentTarget {
  tabId: number | null;
  title: string | null;
  /** Hostname only (e.g. "company.salesforce.com") — never the full URL. */
  hostname: string | null;
  /** Whether Chrome lets the extension inspect the page (describePage). */
  inspectable: boolean;
  /** describePage's sentence: why it can or can't be inspected. */
  detail: string;
  /** True until the tab has been read once. */
  checking: boolean;
}

/** The tab as read; the URL stays inside this hook. */
interface TabRead {
  tabId: number | null;
  title: string | null;
  url: string | undefined;
  fileAccess: boolean;
}

const NO_TAB: TabRead = {
  tabId: null,
  title: null,
  url: undefined,
  fileAccess: true,
};

async function fileAccessAllowed(): Promise<boolean> {
  try {
    return (await chrome.extension?.isAllowedFileSchemeAccess?.()) ?? true;
  } catch {
    return true;
  }
}

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * `sessionId` is the conversation id (`core.Session.id`) — once it's bound
 * to a tab (see `conversation-tab-binding.ts`), this hook follows that tab
 * specifically. Before a binding exists, it follows whichever tab is
 * currently active/focused, same as a fresh conversation would resolve
 * against on its first message.
 */
export function useCurrentTarget(sessionId: string | null): CurrentTarget {
  const { t } = useTranslation();
  const [read, setRead] = useState<TabRead | null>(null);
  const boundTabId = peekConversationTabBinding(sessionId);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const tab =
          boundTabId != null
            ? await chrome.tabs.get(boundTabId)
            : (
                await chrome.tabs.query({ active: true, currentWindow: true })
              )[0];

        if (cancelled) return;
        if (!tab) {
          setRead(NO_TAB);
          return;
        }
        const fileAccess = await fileAccessAllowed();
        if (cancelled) return;
        setRead({
          tabId: tab.id ?? null,
          title: tab.title ?? null,
          url: tab.url,
          fileAccess,
        });
      } catch {
        if (!cancelled) setRead(NO_TAB);
      }
    }

    void refresh();

    const onUpdated = (
      tabId: number,
      _info: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (boundTabId != null ? tabId === boundTabId : tab.active) {
        void refresh();
      }
    };
    const onActivated = () => {
      if (boundTabId == null) {
        void refresh();
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);

    return () => {
      cancelled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, [boundTabId]);

  const access = describePage(read?.url, read?.fileAccess, t);
  return {
    tabId: read?.tabId ?? null,
    title: read?.title ?? null,
    hostname: hostnameOf(read?.url),
    inspectable: access.inspectable,
    detail: access.detail,
    checking: read === null,
  };
}
