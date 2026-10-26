import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { navigationStore } from "../../state/navigation-store";
import {
  revealDomConfigCard,
  useDomConfigState,
} from "../investigation/dom-config/dom-config-store";
import { useDomHealthState } from "../investigation/dom-health-store";
import { domConfigStatus, domHealthStatus, elapsedLabel } from "./job-status";

/** The current time, ticking each second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

interface Job {
  id: "dom-health" | "dom-config";
  tool: string;
  detail: string;
  startedAt: number | null;
  view: () => void;
}

/**
 * A 40 px bar per running job, under the context bar on Home and in chat:
 * the tool, its progress and the elapsed time, and View to open its page.
 */
export function JobBar() {
  const { t } = useTranslation();
  const health = useDomHealthState();
  const config = useDomConfigState();
  const jobs: Job[] = [];
  if (health.running) {
    jobs.push({
      id: "dom-health",
      tool: t("shell.domHealth"),
      detail: domHealthStatus(health, t).label,
      startedAt: health.startedAt,
      view: () => navigationStore.openPage("dom-health"),
    });
  }
  if (config.phase === "running" || config.phase === "stopping") {
    jobs.push({
      id: "dom-config",
      tool: t("shell.domConfig"),
      detail: domConfigStatus(config, t).label,
      startedAt: config.startedAt,
      view: () => revealDomConfigCard(),
    });
  }
  const now = useNow(jobs.length > 0);

  if (jobs.length === 0) return null;
  return (
    <section aria-label={t("jobs.label")} className="shrink-0">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex h-10 items-center gap-2 border-b border-border px-4"
        >
          <Loader2Icon
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin text-info motion-reduce:animate-none"
          />
          <span className="min-w-0 flex-1 truncate text-small text-foreground">
            {t("jobs.line", {
              tool: job.tool,
              detail: job.detail,
              elapsed: elapsedLabel(job.startedAt ?? now, now),
            })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${t("jobs.view")}: ${job.tool}`}
            onClick={job.view}
          >
            {t("jobs.view")}
          </Button>
        </div>
      ))}
    </section>
  );
}
