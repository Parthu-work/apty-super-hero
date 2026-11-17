/**
 * The site's Apty version in the context bar (KB-RAG K27, F7), with how it
 * was decided: the Client's files, a check's files or the SE's choice.
 * Nothing is shown while the version is unknown.
 */
import {
  kbVersionForHost,
  kbVersionSourceForHost,
  subscribeKbVersions,
} from "@apty/browser-runtime/kb/kb-version";
import { useTranslation } from "@apty/ui/i18n/context";
import { useEffect, useState } from "react";

export function KbVersionChip({ host }: { host: string | undefined }) {
  const { t } = useTranslation();
  const [, setTick] = useState(0);
  useEffect(() => subscribeKbVersions(() => setTick((n) => n + 1)), []);
  const version = kbVersionForHost(host);
  const source = kbVersionSourceForHost(host);
  if (version === "unknown" || !source) return null;
  return (
    <span
      className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
      data-testid="kb-version-chip"
    >
      {t(`kbMatches.versionChip.${source}`, { version })}
    </span>
  );
}
