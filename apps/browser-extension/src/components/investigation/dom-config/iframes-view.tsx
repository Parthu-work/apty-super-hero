import type { DomConfigReport } from "@apty/browser-runtime/apty/dom-config/index";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import { TriangleAlertIcon } from "lucide-react";
import { toneTextClass } from "../tone-classes";
import { pathOf, tsv } from "./copy-format";
import { CopyButton, Wrapped } from "./report-parts";

type Translate = I18nContextValue["t"];
type IframeEntry = DomConfigReport["iframes"][number];

const KINDS: { kind: IframeEntry["kind"]; label: TranslationKey }[] = [
  { kind: "application", label: "domConfig.iframes.application" },
  { kind: "extension", label: "domConfig.iframes.extension" },
  { kind: "overlay", label: "domConfig.iframes.overlay" },
];

function crossOriginText(t: Translate, entry: IframeEntry): string {
  return t(
    entry.crossOrigin === null
      ? "domConfig.iframes.unknown"
      : entry.crossOrigin
        ? "domConfig.iframes.yes"
        : "domConfig.iframes.no",
  );
}

/** Application iframes that need handling first, then the rest of each kind. */
function grouped(report: DomConfigReport) {
  return KINDS.map(({ kind, label }) => ({
    kind,
    label,
    entries: report.iframes
      .filter((f) => f.kind === kind)
      .sort((a, b) => Number(b.needsHandling) - Number(a.needsHandling)),
  })).filter((group) => group.entries.length > 0);
}

export function iframesTableText(t: Translate, report: DomConfigReport) {
  return tsv(
    [
      t("domConfig.iframes.kind"),
      t("domConfig.iframes.src"),
      t("domConfig.iframes.crossOrigin"),
      t("domConfig.iframes.analyzed"),
      t("domConfig.iframes.needsHandling"),
      t("domConfig.table.reason"),
      t("domConfig.table.pages"),
    ],
    grouped(report).flatMap((group) =>
      group.entries.map((entry) => [
        t(group.label),
        entry.src,
        crossOriginText(t, entry),
        t(entry.analyzed ? "domConfig.iframes.yes" : "domConfig.iframes.no"),
        t(
          entry.needsHandling
            ? "domConfig.iframes.yes"
            : "domConfig.iframes.no",
        ),
        entry.reason,
        entry.pages.map(pathOf).join(", "),
      ]),
    ),
  );
}

export function IframesView({ report }: { report: DomConfigReport }) {
  const { t } = useTranslation();
  const groups = grouped(report);
  if (groups.length === 0) {
    return (
      <p className="pt-1 text-xs text-foreground">
        {t("domConfig.iframes.none")}
      </p>
    );
  }
  return (
    <div className="space-y-3 pt-1 text-xs">
      <div className="flex justify-end">
        <CopyButton
          text={iframesTableText(t, report)}
          what={t("domConfig.tabs.iframes")}
          label={t("domConfig.copyTable")}
          ariaLabel={t("domConfig.copyTableAria", {
            section: t("domConfig.tabs.iframes"),
          })}
        />
      </div>
      {groups.map((group) => (
        <section
          key={group.kind}
          aria-label={t(group.label)}
          className="space-y-1.5"
        >
          <h4 className="font-medium text-foreground">
            {t(group.label)} ({group.entries.length})
          </h4>
          <ul className="space-y-1.5">
            {group.entries.map((entry) => (
              <li
                key={`${entry.src}\u0000${entry.pages.join()}`}
                className="space-y-0.5 rounded-md border px-2 py-1.5"
              >
                <div className="flex items-start justify-between gap-1">
                  <Wrapped className="font-mono text-foreground">
                    {entry.src}
                  </Wrapped>
                  <CopyButton text={entry.src} what={entry.src} />
                </div>
                {entry.needsHandling && (
                  <p className="flex items-center gap-1 font-medium text-foreground">
                    <TriangleAlertIcon
                      className={cn("size-3", toneTextClass("warning"))}
                      aria-hidden="true"
                    />
                    {t("domConfig.iframes.needsHandling")}
                  </p>
                )}
                <p className="text-foreground">
                  {t("domConfig.iframes.facts", {
                    crossOrigin: crossOriginText(t, entry),
                    analyzed: t(
                      entry.analyzed
                        ? "domConfig.iframes.yes"
                        : "domConfig.iframes.no",
                    ),
                  })}
                </p>
                {!entry.analyzed && (
                  <p className="text-foreground">{entry.reason}</p>
                )}
                <p className="text-muted-foreground">
                  {t("domConfig.rules.pages", {
                    pages: entry.pages.map(pathOf).join(", "),
                  })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
