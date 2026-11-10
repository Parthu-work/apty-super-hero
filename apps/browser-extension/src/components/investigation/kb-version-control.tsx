/**
 * "Apty version: 4.x / 5.x / Not sure" (KB-RAG K12): which version's KB
 * cards the side panel searches for the site in the active tab. A check's
 * files decide it when a check has run there; otherwise the user's choice,
 * kept in memory for this side panel only (`kb-version.ts`).
 */

import { siteHostOf } from "@apty/browser-runtime/conversation/site-host";
import type { KbTabVersion } from "@apty/browser-runtime/kb/kb-index";
import {
  kbVersionForHost,
  kbVersionFromEvidence,
  rememberKbVersion,
} from "@apty/browser-runtime/kb/kb-version";
import { useTranslation } from "@apty/ui/i18n/context";
import { useEffect, useId, useState } from "react";

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

const CHOICES: KbTabVersion[] = ["4.x", "5.x", "unknown"];

export function KbVersionControl({
  host,
  onChange,
}: {
  host: string | undefined;
  onChange?: (version: KbTabVersion) => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  const [version, setVersion] = useState<KbTabVersion>(() =>
    kbVersionForHost(host),
  );
  useEffect(() => setVersion(kbVersionForHost(host)), [host]);

  if (kbVersionFromEvidence(host)) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("kbVersion.fromCheck", { version })}
      </p>
    );
  }
  const label = t("kbVersion.label");
  return (
    <fieldset className="flex flex-wrap items-center gap-3 text-xs">
      <legend className="sr-only">{label}</legend>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap items-center gap-3"
      >
        <span aria-hidden="true" className="text-muted-foreground">
          {label}:
        </span>
        {CHOICES.map((choice) => (
          <label key={choice} className="inline-flex items-center gap-1">
            <input
              type="radio"
              name={name}
              value={choice}
              checked={version === choice}
              onChange={() => {
                setVersion(choice);
                rememberKbVersion(host, choice, "user");
                onChange?.(choice);
              }}
              className="accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            {choice === "unknown" ? t("kbVersion.notSure") : choice}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
