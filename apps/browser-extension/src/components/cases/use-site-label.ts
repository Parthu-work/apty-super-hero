/**
 * How the panel names a tab's site (KB-RAG K27, F4): its host, or
 * customer-a, customer-b when "Show sites as customer-a, customer-b" is on,
 * so a screen share or a pasted screenshot does not name the customer.
 */
import {
  type CaseRecord,
  hostAlias,
  STORAGE_KEYS,
  siteKeyOf,
} from "@apty/agent-core";
import { useCallback, useEffect, useState } from "react";
import { caseRecorder, caseStore } from "../../services/cases";

export interface SiteLabels {
  aliases: boolean;
  setAliases: (on: boolean) => Promise<void>;
  /** The site as shown: its host or alias; a site key names the case's host it belongs to, else "another site". */
  label: (site: string | undefined) => string | undefined;
}

/** The alias preference in chrome.storage.local; off where there is no extension storage. */
function useAliasPreference(): [boolean, (on: boolean) => Promise<void>] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const storage = globalThis.chrome?.storage;
    if (!storage?.local) return undefined;
    let live = true;
    Promise.resolve(storage.local.get(STORAGE_KEYS.SITE_ALIASES))
      .then(
        (items) => live && setOn(items?.[STORAGE_KEYS.SITE_ALIASES] === true),
      )
      .catch(() => undefined);
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      const change = changes[STORAGE_KEYS.SITE_ALIASES];
      if (change) setOn(change.newValue === true);
    };
    storage.onChanged?.addListener(listener);
    return () => {
      live = false;
      storage.onChanged?.removeListener(listener);
    };
  }, []);
  const set = useCallback(async (value: boolean) => {
    setOn(value);
    await globalThis.chrome?.storage?.local?.set({
      [STORAGE_KEYS.SITE_ALIASES]: value,
    });
  }, []);
  return [on, set];
}

export function useSiteLabels(): SiteLabels {
  const [stored, setStored] = useAliasPreference();
  const [cases, setCases] = useState<CaseRecord[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => {
      Promise.resolve(caseStore().list())
        .then((list) => live && setCases(list ?? []))
        .catch(() => undefined);
    };
    load();
    const unsubscribe = caseRecorder().subscribe(load);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  const aliases = stored;
  const label = useCallback(
    (site: string | undefined) => {
      if (!site) return undefined;
      const host = /^site-[0-9a-f]{8}$/.test(site)
        ? cases.find(
            (record) => record.tabHost && siteKeyOf(record.tabHost) === site,
          )?.tabHost
        : site;
      if (!host) return undefined;
      return aliases ? hostAlias(host, cases) : host;
    },
    [aliases, cases],
  );
  return { aliases, setAliases: setStored, label };
}
