import type { DomHealthGrade } from "@apty/browser-runtime";
import type { StatusTone } from "@apty/ui/components/ui/badge";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import type { DomConfigState } from "../investigation/dom-config/dom-config-store";
import {
  type DomHealthState,
  domHealthPhase,
} from "../investigation/dom-health-store";

type Translate = I18nContextValue["t"];

/** A tool's state in words: what the menu row and the job bar show. */
export interface JobStatus {
  tone: StatusTone;
  label: string;
  running: boolean;
}

/** A running job's progress: "page n" or "page n of m", when known. */
interface JobProgress {
  page: number;
  of: number | null;
}

const GRADE: Record<
  DomHealthGrade,
  { label: TranslationKey; tone: StatusTone }
> = {
  EXCELLENT: { label: "domHealth.grade.excellent", tone: "success" },
  GOOD: { label: "domHealth.grade.good", tone: "success" },
  FAIR: { label: "domHealth.grade.fair", tone: "warning" },
  NEEDS_ATTENTION: { label: "domHealth.grade.needsAttention", tone: "warning" },
  HIGH_RISK: { label: "domHealth.grade.highRisk", tone: "danger" },
  NOT_ASSESSED: { label: "domHealth.grade.notAssessed", tone: "neutral" },
};

function domHealthProgress(state: DomHealthState): JobProgress | null {
  return state.running === "application" && state.progress?.phase === "auditing"
    ? { page: state.progress.pageIndex + 1, of: null }
    : null;
}

function domConfigProgress(state: DomConfigState): JobProgress | null {
  return state.current?.phase === "capturing"
    ? { page: state.current.stateIndex + 1, of: state.current.maxStates }
    : null;
}

function progressLabel(progress: JobProgress, t: Translate): string {
  return progress.of === null
    ? t("jobs.page", { page: progress.page })
    : t("jobs.pageOf", { page: progress.page, of: progress.of });
}

/** Not checked, running, "score · grade", or couldn't finish. */
export function domHealthStatus(
  state: DomHealthState,
  t: Translate,
): JobStatus {
  switch (domHealthPhase(state)) {
    case "idle":
      return { tone: "neutral", label: t("jobs.notChecked"), running: false };
    case "running": {
      const progress = domHealthProgress(state);
      return {
        tone: "info",
        label: progress ? progressLabel(progress, t) : t("jobs.running"),
        running: true,
      };
    }
    case "failed":
      return { tone: "danger", label: t("jobs.couldntFinish"), running: false };
    case "result": {
      const outcome =
        state.scope === "application" ? state.appOutcome : state.pageOutcome;
      if (!outcome?.available) {
        return {
          tone: "danger",
          label: t("jobs.couldntFinish"),
          running: false,
        };
      }
      const grade = GRADE[outcome.grade];
      return {
        tone: grade.tone,
        label:
          outcome.score === null
            ? t(grade.label)
            : t("jobs.scoreGrade", {
                score: outcome.score,
                grade: t(grade.label),
              }),
        running: false,
      };
    }
  }
}

/** Not generated, running (page n of m), not exported, exported, or couldn't finish. */
export function domConfigStatus(
  state: DomConfigState,
  t: Translate,
): JobStatus {
  if (state.phase === "running" || state.phase === "stopping") {
    const progress = domConfigProgress(state);
    return {
      tone: "info",
      label:
        state.phase === "stopping"
          ? t("jobs.stopping")
          : progress
            ? progressLabel(progress, t)
            : t("jobs.running"),
      running: true,
    };
  }
  if (state.phase === "failed") {
    return { tone: "danger", label: t("jobs.couldntFinish"), running: false };
  }
  if (state.report) {
    return state.exportedAt === null
      ? { tone: "warning", label: t("jobs.notExported"), running: false }
      : { tone: "success", label: t("jobs.exported"), running: false };
  }
  return { tone: "neutral", label: t("jobs.notGenerated"), running: false };
}

/** Elapsed time as m:ss. */
export function elapsedLabel(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
