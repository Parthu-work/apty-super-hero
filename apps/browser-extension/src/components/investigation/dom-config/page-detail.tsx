import type {
  DomConfigApplicationCapture,
  DomConfigReport,
} from "@apty/browser-runtime/apty/dom-config/index";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  DownloadIcon,
  ScissorsIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toneTextClass } from "../tone-classes";
import { download, pathOf, profileFileName } from "./copy-format";
import type { PageRow } from "./dom-config-store";
import { RowSummary, RUN_LABEL, RunChips, rowName } from "./progress-view";
import { Wrapped } from "./report-parts";

type PageSummary = DomConfigReport["pages"][number];
type RunPairDiff = PageSummary["diffs"][number];
type HeldPage = DomConfigApplicationCapture["pages"][number];

const CHANGE: Record<RunPairDiff["values"][number]["change"], TranslationKey> =
  {
    added: "domConfig.detail.added",
    removed: "domConfig.detail.removed",
    count: "domConfig.detail.countChanged",
  };

function DiffList({ diff }: { diff: Pick<RunPairDiff, "values" | "tags"> }) {
  const { t } = useTranslation();
  if (diff.values.length === 0 && diff.tags.length === 0) {
    return (
      <p className="text-muted-foreground">{t("domConfig.detail.noChange")}</p>
    );
  }
  return (
    <ul className="space-y-1">
      {diff.values.map((entry) => (
        <li
          key={`${entry.name}\u0000${entry.value}`}
          className="flex flex-wrap items-baseline gap-x-1.5 rounded-sm border px-1.5 py-1"
        >
          <span className="font-mono text-foreground">{entry.name}</span>
          <span className="text-muted-foreground">
            {t(CHANGE[entry.change])}
          </span>
          <Wrapped className="font-mono text-foreground">{entry.value}</Wrapped>
          <span className="text-muted-foreground">
            {t("domConfig.detail.counts", {
              from: entry.fromCount,
              to: entry.toCount,
            })}
          </span>
        </li>
      ))}
      {diff.tags.map((entry) => (
        <li
          key={entry.tag}
          className="flex flex-wrap items-baseline gap-x-1.5 rounded-sm border px-1.5 py-1"
        >
          <span className="font-mono text-foreground">{`<${entry.tag}>`}</span>
          <span className="text-muted-foreground">
            {t("domConfig.detail.counts", {
              from: entry.fromCount,
              to: entry.toCount,
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RawProfileDownload({ page, run }: { page: HeldPage; run: number }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const profile = page.runs[run]?.profile;
  if (!profile) return null;
  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-6 gap-1 px-1.5 text-[11px]"
        aria-label={t("domConfig.detail.rawAria", { run: run + 1 })}
        onClick={() => setConfirming(true)}
      >
        <DownloadIcon className="size-3" aria-hidden="true" />
        {t("domConfig.detail.raw")}
      </Button>
    );
  }
  return (
    <div className="mt-1 w-full space-y-1 rounded-md border border-warning/40 bg-warning/10 p-1.5">
      <p className="text-foreground">{t("domConfig.detail.rawWarning")}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          aria-label={t("domConfig.detail.rawConfirmAria", { run: run + 1 })}
          onClick={() => {
            download(
              JSON.stringify(profile, null, 2),
              profileFileName(page.label, run + 1),
              "application/json",
            );
            setConfirming(false);
          }}
        >
          {t("domConfig.detail.rawConfirm")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={() => setConfirming(false)}
        >
          {t("domConfig.detail.cancel")}
        </Button>
      </div>
    </div>
  );
}

function PageDetail({
  summary,
  page,
}: {
  summary: PageSummary;
  page: HeldPage;
}) {
  const { t } = useTranslation();
  const noise = summary.diffs.filter(
    (d) => d.noiseValues.length > 0 || d.noiseTags.length > 0,
  );
  const runName = (i: number) =>
    t("domConfig.detail.run", {
      index: i + 1,
      label: t(RUN_LABEL[summary.runs[i]?.label ?? "repeat"]),
    });
  return (
    <div className="mt-1.5 space-y-2 border-t pt-1.5 text-[11px]">
      <section aria-label={t("domConfig.detail.runs")} className="space-y-1">
        <h5 className="font-medium text-foreground">
          {t("domConfig.detail.runs")}
        </h5>
        <ul className="space-y-1">
          {summary.runs.map((run, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
              key={i}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
            >
              <span className="font-medium text-foreground">{runName(i)}</span>
              {run.urlShape && (
                <Wrapped className="font-mono text-foreground">
                  {pathOf(run.urlShape)}
                </Wrapped>
              )}
              <span className="text-muted-foreground">
                {t("domConfig.elements", { count: run.elementCount })}
              </span>
              {run.partial && (
                <span className="inline-flex items-center gap-1 text-foreground">
                  <ScissorsIcon
                    className={cn("size-3", toneTextClass("warning"))}
                    aria-hidden="true"
                  />
                  {t("domConfig.detail.partial")}
                </span>
              )}
              {run.stateMismatch && (
                <span className="inline-flex items-center gap-1 text-foreground">
                  <CircleAlertIcon
                    className={cn("size-3", toneTextClass("warning"))}
                    aria-hidden="true"
                  />
                  {t("domConfig.runState.mismatch")}
                </span>
              )}
              <RawProfileDownload page={page} run={i} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t("domConfig.detail.changes")} className="space-y-1">
        <h5 className="font-medium text-foreground">
          {t("domConfig.detail.changes")}
        </h5>
        {summary.diffs.length === 0 && (
          <p className="text-muted-foreground">
            {t("domConfig.detail.oneRun")}
          </p>
        )}
        {summary.diffs.map((diff) => (
          <div key={`${diff.from}-${diff.to}`} className="space-y-1">
            <p className="text-foreground">
              {t("domConfig.detail.pair", {
                from: runName(diff.from),
                to: runName(diff.to),
              })}
            </p>
            <DiffList diff={diff} />
            {diff.truncated && (
              <p className="text-foreground">
                {t("domConfig.detail.truncated")}
              </p>
            )}
          </div>
        ))}
      </section>

      {noise.length > 0 && (
        <details className="rounded-md border px-1.5 py-1">
          <summary className="cursor-pointer text-foreground">
            {t("domConfig.detail.noise")}
          </summary>
          <div className="mt-1 space-y-1">
            {noise.map((diff) => (
              <div key={`${diff.from}-${diff.to}`} className="space-y-1">
                <p className="text-foreground">
                  {t("domConfig.detail.pair", {
                    from: runName(diff.from),
                    to: runName(diff.to),
                  })}
                </p>
                <DiffList
                  diff={{ values: diff.noiseValues, tags: diff.noiseTags }}
                />
              </div>
            ))}
          </div>
        </details>
      )}

      <ul className="space-y-0.5 text-foreground">
        <li>
          {t("domConfig.detail.maxZIndex", {
            value: summary.maxZIndex ?? t("domConfig.detail.none"),
          })}
        </li>
        <li>
          {t("domConfig.detail.shadowHosts", {
            hosts: summary.shadowHosts.length
              ? summary.shadowHosts.join(", ")
              : t("domConfig.detail.none"),
          })}
        </li>
        <li>{t("domConfig.detail.iframes", { count: summary.iframeCount })}</li>
      </ul>
    </div>
  );
}

/** The held pages; each opens to its runs and what changed between them. */
export function PageList({
  rows,
  report,
  capture,
}: {
  rows: PageRow[];
  report: DomConfigReport;
  capture: DomConfigApplicationCapture;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const summaries = new Map(report.pages.map((p) => [p.pageId, p]));
  const pages = new Map(capture.pages.map((p) => [p.pageId, p]));
  return (
    <section aria-label={t("domConfig.pagesTitle")} className="space-y-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("domConfig.pagesTitle")}
      </h4>
      <ul className="space-y-1.5">
        {rows.map((row, i) => {
          const summary = summaries.get(row.key);
          const page = pages.get(row.key);
          const expanded = open === row.key;
          const panel = `${id}-page-${i}`;
          return (
            <li key={row.key} className="rounded-md border px-2 py-1.5">
              {summary && page ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panel}
                  onClick={() => setOpen(expanded ? null : row.key)}
                  className="flex w-full min-w-0 items-start gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRightIcon
                    className={cn(
                      "mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                      expanded && "rotate-90",
                    )}
                    aria-hidden="true"
                  />
                  <RowSummary row={row} />
                </button>
              ) : (
                <RowSummary row={row} />
              )}
              <RunChips runs={row.runs} />
              {expanded && summary && page && (
                <div
                  id={panel}
                  role="region"
                  aria-label={t("domConfig.detail.label", {
                    page: rowName(row),
                  })}
                >
                  <PageDetail summary={summary} page={page} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
