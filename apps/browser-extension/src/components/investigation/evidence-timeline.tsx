/**
 * Correlated investigation timeline (product spec section 14) — renders
 * `CorrelationCluster[]` from `evidence-correlation.ts` exactly as computed,
 * with progressive disclosure into each evidence item's raw (already
 * redacted) data. Never implies correlation the backend didn't establish —
 * the "likely related incident" badge only ever reflects
 * `cluster.likelySameIncident`.
 *
 * Each cluster is a node on a vertical line: its time, the icons of its
 * sources, and a card whose headline is the cluster's plain-language
 * `summary`. The evidence that backs it sits behind one "View details".
 */

import type {
  CorrelationCluster,
  DiagnosticEvidence,
} from "@apty/browser-runtime";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@apty/ui/components/ui/collapsible";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import {
  BoxIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CodeXmlIcon,
  CogIcon,
  CpuIcon,
  GlobeIcon,
  LinkIcon,
  MousePointerClickIcon,
  PuzzleIcon,
  TerminalIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { JsonTree } from "./json-tree";

const SOURCE_META: Record<
  DiagnosticEvidence["source"],
  { Icon: ComponentType<{ className?: string }>; label: TranslationKey }
> = {
  dom: { Icon: CodeXmlIcon, label: "investigation.timeline.source.dom" },
  console: {
    Icon: TerminalIcon,
    label: "investigation.timeline.source.console",
  },
  network: { Icon: GlobeIcon, label: "investigation.timeline.source.network" },
  runtime: { Icon: CpuIcon, label: "investigation.timeline.source.runtime" },
  "apty-client": {
    Icon: BoxIcon,
    label: "investigation.timeline.source.aptyClient",
  },
  "apty-widget": {
    Icon: PuzzleIcon,
    label: "investigation.timeline.source.aptyWidget",
  },
  "apty-studio": {
    Icon: MousePointerClickIcon,
    label: "investigation.timeline.source.aptyStudio",
  },
  "service-worker": {
    Icon: CogIcon,
    label: "investigation.timeline.source.serviceWorker",
  },
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

function EvidenceItem({ item }: { item: DiagnosticEvidence }) {
  const { t } = useTranslation();
  const source = SOURCE_META[item.source];
  const failed = isFailure(item.type);
  return (
    <li className="space-y-1 py-2">
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {failed && (
          <>
            <CircleAlertIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-destructive"
            />
            <span className="font-medium text-destructive">
              {t("investigation.timeline.failure")}
            </span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>{source ? t(source.label) : item.source}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{item.type}</span>
        <span aria-hidden="true">·</span>
        <time className="font-mono">{formatClockTime(item.timestamp)}</time>
      </p>
      {item.url && (
        <p className="break-all font-mono text-xs text-muted-foreground">
          {item.url}
        </p>
      )}
      <JsonTree value={item.data} />
    </li>
  );
}

function TimelineCluster({ cluster }: { cluster: CorrelationCluster }) {
  const { t } = useTranslation();
  const sources = [...new Set(cluster.evidence.map((e) => e.source))];
  return (
    <li className="relative space-y-1.5">
      <span
        aria-hidden="true"
        className="absolute top-0.5 -left-5 size-3 rounded-full border-2 border-input bg-background"
      />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <time className="font-mono">
          {formatClockTime(cluster.startTimestamp)}
        </time>
        {sources.map((source) => {
          const Icon = SOURCE_META[source]?.Icon ?? LinkIcon;
          return <Icon key={source} aria-hidden="true" className="size-3.5" />;
        })}
      </p>
      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <h4 className="text-sm font-medium text-foreground">
          {cluster.summary}
        </h4>
        {cluster.likelySameIncident && (
          <StatusBadge tone="info" icon={LinkIcon}>
            {t("investigation.timeline.likelyRelated")}
          </StatusBadge>
        )}
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 rounded-sm text-xs font-medium text-info outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <span className="group-data-[state=open]:hidden">
              {t("investigation.timeline.viewDetails")}
            </span>
            <span className="hidden group-data-[state=open]:inline">
              {t("investigation.timeline.hide")}
            </span>
            <span className="text-muted-foreground">
              {t("investigation.timeline.evidence", {
                count: cluster.evidence.length,
              })}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y divide-border">
              {cluster.evidence.map((item) => (
                <EvidenceItem key={item.evidenceId} item={item} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
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
      <p className="py-2 text-sm text-muted-foreground">
        {t("investigation.timeline.none")}
      </p>
    );
  }

  return (
    <ol
      className="relative space-y-4 pl-5 before:absolute before:top-2 before:bottom-2 before:left-1.5 before:w-px before:bg-border"
      aria-label={t("investigation.timeline.label")}
    >
      {clusters.map((cluster) => (
        <TimelineCluster key={cluster.clusterId} cluster={cluster} />
      ))}
    </ol>
  );
}
