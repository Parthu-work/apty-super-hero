import { Notice } from "@apty/ui/components/ui/notice";
import { ProgressBar } from "@apty/ui/components/ui/progress-bar";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { elapsedLabel } from "../../shell/job-status";
import { useNow } from "../../shell/use-now";
import { toneTextClass } from "../tone-classes";
import { pathOf } from "./copy-format";
import type { DomConfigState, PageRow } from "./dom-config-store";
import { actionSentence, RunChips, rowName } from "./progress-view";

function RowIcon({ row }: { row: PageRow }) {
  const states = row.runs.map((run) => run.state);
  if (states.includes("running")) {
    return (
      <LoaderCircleIcon
        aria-hidden="true"
        className={cn(
          "size-4 motion-safe:animate-spin",
          toneTextClass("active"),
        )}
      />
    );
  }
  if (states.includes("failed")) {
    return (
      <CircleXIcon
        aria-hidden="true"
        className={cn("size-4", toneTextClass("danger"))}
      />
    );
  }
  if (states.includes("mismatch")) {
    return (
      <CircleAlertIcon
        aria-hidden="true"
        className={cn("size-4", toneTextClass("warning"))}
      />
    );
  }
  return (
    <CircleCheckIcon
      aria-hidden="true"
      className={cn("size-4", toneTextClass("success"))}
    />
  );
}

function CapturedRow({ row }: { row: PageRow }) {
  const { t } = useTranslation();
  const running = row.runs.findIndex((run) => run.state === "running");
  const done = row.runs.filter(
    (run) => run.state === "done" || run.state === "mismatch",
  ).length;
  const troubled = row.runs.some(
    (run) => run.state === "failed" || run.state === "mismatch",
  );
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5 shrink-0">
        <RowIcon row={row} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-sm text-foreground [overflow-wrap:anywhere]">
          {rowName(row)}
        </span>
        {troubled && <RunChips runs={row.runs} />}
      </span>
      <span className="shrink-0 text-small text-muted-foreground">
        {running >= 0
          ? t("domConfig.page.runOf", {
              run: running + 1,
              runs: row.runs.length,
            })
          : t("domConfig.page.runsDone", {
              done,
              total: row.runs.length,
            })}
      </span>
    </li>
  );
}

/** A crawl in progress: its page, run and time, and the pages captured so far. */
export function RunningView({ state }: { state: DomConfigState }) {
  const { t } = useTranslation();
  const now = useNow(true);
  const last = state.lastCapture;
  const stopping = state.phase === "stopping";
  const current = state.current;
  const path = pathOf(
    (current && "urlShape" in current ? current.urlShape : last?.urlShape) ??
      "",
  );
  const rows = state.rows.filter((row) => row.runs.length > 0);
  return (
    <div>
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <LoaderCircleIcon
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-5 shrink-0 motion-safe:animate-spin",
              toneTextClass("active"),
            )}
          />
          <div className="min-w-0 space-y-1">
            <h3 className="text-title font-semibold text-foreground">
              {last
                ? t("domConfig.page.capturingTitle", {
                    page: last.stateIndex,
                    of: last.maxStates,
                  })
                : t("domConfig.status.running")}
            </h3>
            {path && (
              <p className="font-mono text-sm text-foreground [overflow-wrap:anywhere]">
                {path}
              </p>
            )}
            <p className="text-small text-muted-foreground" aria-live="polite">
              {actionSentence(t, state.current, stopping)}
            </p>
          </div>
        </div>
        <ProgressBar
          value={last ? (last.stateIndex / last.maxStates) * 100 : null}
          tone="info"
          aria-label={t("domConfig.page.progress")}
        />
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-small text-muted-foreground">
          <span>
            {last
              ? t("domConfig.page.runOf", {
                  run: last.runIndex,
                  runs: last.runCount,
                })
              : null}
          </span>
          <span>
            {t("domConfig.page.timeOf", {
              elapsed: elapsedLabel(state.startedAt ?? now, now),
              limit: `${state.options.maxMinutes}:00`,
            })}
          </span>
        </div>
      </section>

      {rows.length > 0 && (
        <section
          aria-label={t("domConfig.page.capturedSoFar")}
          className="mt-6"
        >
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("domConfig.page.capturedSoFar")}
          </h3>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <CapturedRow key={row.key} row={row} />
            ))}
          </ul>
        </section>
      )}

      <Notice tone="info" className="mt-4">
        {t("domConfig.page.navigating")}
      </Notice>
    </div>
  );
}
