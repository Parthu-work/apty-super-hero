/**
 * The site host of the active tab, whose Apty version decides which KB
 * cards the side panel shows (KB-RAG K12). The version is chosen in the
 * answer's question and the header's version chip (K29, D3).
 */

import { siteHostOf } from "@apty/browser-runtime/conversation/site-host";
import { useEffect, useState } from "react";

/** The site host of the active tab, or undefined outside the extension. */
export function useActiveSiteHost(): string | undefined {
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => {
    let live = true;
    if (typeof chrome === "undefined" || !chrome.tabs?.query) return;
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => live && setHost(siteHostOf(tab?.url)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return host;
}
