import type { DomConfigCaptureProgress } from "@apty/browser-runtime/apty/dom-config/index";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  FileInputIcon,
  HandIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { toneBadgeClass, toneTextClass } from "../tone-classes";
import { pathOf } from "./copy-format";
import type { PageOrigin, PageRow, RunChipState } from "./dom-config-store";

type Translate = I18nContextValue["t"];

export const RUN_LABEL: Record<
  PageRow["runs"][number]["label"],
  TranslationKey
> = {
  initial: "domConfig.runLabel.initial",
  "after-reload": "domConfig.runLabel.afterReload",
  repeat: "domConfig.runLabel.repeat",
};

const CHIP: Record<
  RunChipState,
  {
    label: TranslationKey;
    icon: typeof CircleIcon;
    tone: "neutral" | "active" | "success" | "warning" | "danger";
  }
> = {
  pending: {
    label: "domConfig.runState.pending",
    icon: CircleIcon,
    tone: "neutral",
  },
  running: {
    label: "domConfig.runState.running",
    icon: LoaderCircleIcon,
    tone: "active",
  },
  done: {
    label: "domConfig.runState.done",
    icon: CircleCheckIcon,
    tone: "success",
  },
  mismatch: {
    label: "domConfig.runState.mismatch",
    icon: CircleAlertIcon,
    tone: "warning",
  },
  failed: {
    label: "domConfig.runState.failed",
    icon: CircleXIcon,
    tone: "danger",
  },
};

const PAGE_STATUS: Record<NonNullable<PageRow["status"]>, TranslationKey> = {
  stable: "domConfig.pageStatus.stable",
  changing: "domConfig.pageStatus.changing",
  unreliable: "domConfig.pageStatus.unreliable",
  "single-run": "domConfig.pageStatus.singleRun",
};

/** The sentence for what the run is doing now. */
export function actionSentence(
  t: Translate,
  progress: DomConfigCaptureProgress | null,
  stopping: boolean,
): string {
  if (stopping) return t("domConfig.action.stopping");
  if (!progress) return t("domConfig.action.starting");
  switch (progress.phase) {
    case "discovering":
      return t("domConfig.action.discovering", {
        page: pathOf(progress.urlShape),
      });
    case "capturing":
      return t(
        progress.runLabel === "initial"
          ? "domConfig.action.capturingInitial"
          : progress.runLabel === "after-reload"
            ? "domConfig.action.capturingAfterReload"
            : "domConfig.action.capturingRepeat",
        {
          run: progress.runIndex,
          runs: progress.runCount,
          page: pathOf(progress.urlShape),
        },
      );
    case "probing":
      return t("domConfig.action.probing", { page: pathOf(progress.urlShape) });
    case "revisiting":
      return t("domConfig.action.revisiting", {
        page: pathOf(progress.urlShape),
      });
    case "restoring":
      return t("domConfig.action.restoring", {
        page: pathOf(progress.urlShape),
      });
    case "analyzing":
      return t("domConfig.action.analyzing");
  }
}

const ORIGIN: Partial<
  Record<PageOrigin, { label: TranslationKey; icon: typeof HandIcon }>
> = {
  manual: { label: "domConfig.origin.manual", icon: HandIcon },
  import: { label: "domConfig.origin.import", icon: FileInputIcon },
};

/** The page's name as shown: a crawled page by its path, others as the SE typed it. */
export function rowName(row: Pick<PageRow, "label" | "origin">): string {
  return row.origin === "crawl" ? pathOf(row.label) : row.label;
}

function OriginBadge({ origin }: { origin: PageOrigin }) {
  const { t } = useTranslation();
  const meta = ORIGIN[origin];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium",
        toneBadgeClass("active"),
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {t(meta.label)}
    </span>
  );
}

/** Name, origin, status and size of a page row. */
export function RowSummary({ row }: { row: PageRow }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="min-w-0 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
        {rowName(row)}
      </span>
      <OriginBadge origin={row.origin} />
      {row.status && (
        <span className="text-xs text-muted-foreground">
          {t(PAGE_STATUS[row.status])}
        </span>
      )}
      {row.elementCount !== null && (
        <span className="text-xs text-muted-foreground">
          {t("domConfig.elements", { count: row.elementCount })}
        </span>
      )}
    </span>
  );
}

export function RunChips({ runs }: { runs: PageRow["runs"] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {runs.map((run, i) => {
        const chip = CHIP[run.state];
        const Icon = chip.icon;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
            key={i}
            className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs"
          >
            <Icon
              className={cn(
                "size-3",
                toneTextClass(chip.tone),
                run.state === "running" && "motion-safe:animate-spin",
              )}
              aria-hidden="true"
            />
            <span className="sr-only">
              {t("domConfig.runChip", {
                index: i + 1,
                label: t(RUN_LABEL[run.label]),
                state: t(chip.label),
              })}
            </span>
            <span aria-hidden="true" className="text-foreground">
              {t(RUN_LABEL[run.label])} · {t(chip.label)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
