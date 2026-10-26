/**
 * Correlated investigation timeline (product spec section 14) — renders
 * `CorrelationCluster[]` from `evidence-correlation.ts` exactly as computed,
 * with progressive disclosure into each evidence item's raw (already
 * redacted) data. Never implies correlation the backend didn't establish —
 * the "likely related incident" badge only ever reflects
 * `cluster.likelySameIncident`.
 *
 * Visual hierarchy: each cluster surfaces its plain-language `summary` as
 * the headline "Observation" — the thing a non-developer reads first — with
 * the underlying `evidence` records available underneath as the "Evidence"
 * that backs it, collapsed by default behind an explicit "View details"
 * affordance.
 */

import type {
  CorrelationCluster,
  DiagnosticEvidence,
} from "@apty/browser-runtime";
import { CodeBlock } from "@apty/ui/components/ai-elements/code-block";
import { Badge } from "@apty/ui/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@apty/ui/components/ui/collapsible";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { toneBadgeClass, toneTextClass } from "./tone-classes";

const SOURCE_ICON: Record<DiagnosticEvidence["source"], string> = {
  dom: "🧱",
  console: "🖥",
  network: "🌐",
  runtime: "🖥",
  "apty-client": "🧠",
  "apty-widget": "🧩",
  "apty-studio": "🎯",
  "service-worker": "⚙️",
};

function formatClockTime(timestampMs: number): string {
  try {
    return new Date(timestampMs).toLocaleTimeString(undefined, {
      hour12: false,
    });
  } catch {
    return String(timestampMs);
  }
}

function isFailure(type: string): boolean {
  return /error|fail|exception|reject/i.test(type);
}

function EvidenceRow({ item }: { item: DiagnosticEvidence }) {
  const { t } = useTranslation();
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40">
        <span aria-hidden="true">{SOURCE_ICON[item.source] ?? "•"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "truncate font-medium",
                isFailure(item.type) && toneTextClass("danger"),
              )}
            >
              {item.type}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatClockTime(item.timestamp)}
            </span>
          </div>
          {item.url && (
            <p className="truncate text-xs text-muted-foreground">{item.url}</p>
          )}
        </div>
        <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
          <span className="hidden group-data-[state=closed]:inline">
            {t("investigation.timeline.viewDetails")}
          </span>
          <span className="hidden group-data-[state=open]:inline">
            {t("investigation.timeline.hide")}
          </span>
          <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1 pb-1 pl-8 pr-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("investigation.timeline.rawData")}
        </p>
        <CodeBlock code={JSON.stringify(item.data, null, 2)} language="json" />
      </CollapsibleContent>
    </Collapsible>
  );
}

function TimelineCluster({ cluster }: { cluster: CorrelationCluster }) {
  const { t } = useTranslation();
  return (
    <li className="overflow-hidden rounded-md border bg-card">
      <div className="space-y-1 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("investigation.timeline.observation", {
              time: formatClockTime(cluster.startTimestamp),
            })}
          </span>
          {cluster.likelySameIncident && (
            <Badge
              className={cn("gap-1", toneBadgeClass("warning"))}
              variant="outline"
            >
              <TriangleAlertIcon className="size-3" />
              {t("investigation.timeline.likelyRelated")}
            </Badge>
          )}
        </div>
        <p className="text-sm font-medium leading-snug">{cluster.summary}</p>
      </div>
      <div className="border-t px-2 py-1.5">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {t("investigation.timeline.evidence", {
            count: cluster.evidence.length,
          })}
        </p>
        <div className="divide-y divide-border/60">
          {cluster.evidence.map((item) => (
            <EvidenceRow key={item.evidenceId} item={item} />
          ))}
        </div>
      </div>
    </li>
  );
}

export function EvidenceTimeline({
  clusters,
}: {
  clusters: CorrelationCluster[];
}) {
  const { t } = useTranslation();
  if (clusters.length === 0) {
    return (
      <p className="px-2 py-4 text-center text-sm text-muted-foreground">
        {t("investigation.timeline.none")}
      </p>
    );
  }

  return (
    <ol className="space-y-2" aria-label={t("investigation.timeline.label")}>
      {clusters.map((cluster) => (
        <TimelineCluster key={cluster.clusterId} cluster={cluster} />
      ))}
    </ol>
  );
}
