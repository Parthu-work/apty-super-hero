/**
 * Correlated investigation timeline (product spec section 14) — renders
 * `CorrelationCluster[]` from `evidence-correlation.ts` exactly as computed,
 * with progressive disclosure into each evidence item's raw (already
 * redacted) data. Never implies correlation the backend didn't establish —
 * the "likely related incident" badge only ever reflects
 * `cluster.likelySameIncident`.
 */
import { CodeBlock } from "@aipexstudio/aipex-react/components/ai-elements/code-block";
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
import { ChevronDownIcon } from "lucide-react";

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
                isFailure(item.type) && "text-red-600 dark:text-red-400",
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
        <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-1 pl-8 pr-2">
        <CodeBlock code={JSON.stringify(item.data, null, 2)} language="json" />
      </CollapsibleContent>
    </Collapsible>
  );
}

function TimelineCluster({ cluster }: { cluster: CorrelationCluster }) {
  return (
    <li className="rounded-md border p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {formatClockTime(cluster.startTimestamp)}
        </span>
        {cluster.likelySameIncident && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            ⚠ Likely related incident
          </span>
        )}
      </div>
      <p className="mb-1 text-sm">{cluster.summary}</p>
      <div className="divide-y divide-border/60">
        {cluster.evidence.map((item) => (
          <EvidenceRow key={item.evidenceId} item={item} />
        ))}
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
