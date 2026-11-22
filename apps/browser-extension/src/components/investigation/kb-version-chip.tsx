/**
 * The site's Apty version in the context bar (KB-RAG K27, F7), with how it
 * was decided: the Client's files, a check's files or the SE's choice. Its
 * menu changes the version at any time (K29, D3): 4.x, 5.x or Not sure,
 * kept per site on the device; a check's files outrank a choice, so their
 * version is shown and the choices are off.
 */
import type { KbTabVersion } from "@apty/browser-runtime/kb/kb-index";
import {
  kbVersionForHost,
  kbVersionSourceForHost,
  markKbVersionQuestioned,
  rememberKbVersion,
  subscribeKbVersions,
} from "@apty/browser-runtime/kb/kb-version";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@apty/ui/components/ui/dropdown-menu";
import { useTranslation } from "@apty/ui/i18n/context";
import { useEffect, useState } from "react";

const VERSIONS: KbTabVersion[] = ["4.x", "5.x", "unknown"];

/** Re-renders when any site's version or answered question changes. */
export function useKbVersionsTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => subscribeKbVersions(() => setTick((n) => n + 1)), []);
}

/** Sets the site's version as the SE's choice and marks its question answered. */
export function chooseKbVersion(
  host: string | undefined,
  version: KbTabVersion,
): void {
  markKbVersionQuestioned(host);
  rememberKbVersion(host, version, "user");
}

export function KbVersionChip({ host }: { host: string | undefined }) {
  const { t } = useTranslation();
  useKbVersionsTick();
  if (!host) return null;
  const version = kbVersionForHost(host);
  const source = kbVersionSourceForHost(host);
  const known = version !== "unknown" && source;
  const label = known
    ? t(`kbMatches.versionChip.${source}`, { version })
    : t("kbMatches.versionChip.unknown");
  const fromEvidence = source === "evidence";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={t("kbVersion.chipName", {
            host,
            state: known ? label : t("kbVersion.notKnown"),
          })}
          data-testid="kb-version-chip"
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("kbVersion.menuLabel", { host })}
        </DropdownMenuLabel>
        {fromEvidence && (
          <p className="px-2 pb-1 text-xs text-foreground">{label}</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={version}
          onValueChange={(value) =>
            chooseKbVersion(host, value as KbTabVersion)
          }
        >
          {VERSIONS.map((choice) => (
            <DropdownMenuRadioItem
              key={choice}
              value={choice}
              disabled={fromEvidence}
            >
              {choice === "unknown" ? t("kbVersion.notSure") : choice}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
