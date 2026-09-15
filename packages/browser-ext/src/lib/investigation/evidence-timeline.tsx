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

import { CodeBlock } from "@aipexstudio/aipex-react/components/ai-elements/code-block";
import { Badge } from "@aipexstudio/aipex-react/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@aipexstudio/aipex-react/components/ui/collapsible";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import type {
  CorrelationCluster,
  DiagnosticEvidence,
} from "@aipexstudio/browser-runtime";
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
            View details
          </span>
          <span className="hidden group-data-[state=open]:inline">Hide</span>
          <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1 pb-1 pl-8 pr-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Raw evidence data
        </p>
        <CodeBlock code={JSON.stringify(item.data, null, 2)} language="json" />
      </CollapsibleContent>
    </Collapsible>
  );
}

function TimelineCluster({ cluster }: { cluster: CorrelationCluster }) {
  return (
    <li className="overflow-hidden rounded-md border bg-card">
      <div className="space-y-1 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Observation · {formatClockTime(cluster.startTimestamp)}
          </span>
          {cluster.likelySameIncident && (
            <Badge
              className={cn("gap-1", toneBadgeClass("warning"))}
              variant="outline"
            >
              <TriangleAlertIcon className="size-3" />
              Likely related incident
            </Badge>
          )}
        </div>
        <p className="text-sm font-medium leading-snug">{cluster.summary}</p>
      </div>
      <div className="border-t px-2 py-1.5">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Evidence ({cluster.evidence.length})
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
  if (clusters.length === 0) {
    return (
      <p className="px-2 py-4 text-center text-sm text-muted-foreground">
        No evidence collected yet. Evidence appears here as the agent inspects
        the page, console, network, and Apty components.
      </p>
    );
  }

  return (
    <ol className="space-y-2" aria-label="Investigation timeline">
      {clusters.map((cluster) => (
        <TimelineCluster key={cluster.clusterId} cluster={cluster} />
      ))}
    </ol>
  );
}
