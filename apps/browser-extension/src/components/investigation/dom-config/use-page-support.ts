/**
 * Whether the target tab can be analyzed at all: browser and extension
 * pages allow no content script. Reads the tab's URL through `chrome.tabs`
 * and keeps only the verdict.
 */
import { isUnsupportedPage } from "@apty/browser-runtime/apty/dom-health";
import { useEffect, useState } from "react";

type PageSupport = "unknown" | "supported" | "restricted";

export function usePageSupport(tabId: number | null): PageSupport {
  const [support, setSupport] = useState<PageSupport>("unknown");

  useEffect(() => {
    if (tabId === null) {
      setSupport("unknown");
      return;
    }
    let cancelled = false;
    const check = () => {
      chrome.tabs
        .get(tabId)
        .then((tab) => {
          if (!cancelled) {
            setSupport(isUnsupportedPage(tab.url) ? "restricted" : "supported");
          }
        })
        .catch(() => {
          if (!cancelled) setSupport("unknown");
        });
    };
    check();
    const onUpdated = (updatedId: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (updatedId === tabId && (info.url || info.status === "complete")) {
        check();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [tabId]);

  return support;
}
