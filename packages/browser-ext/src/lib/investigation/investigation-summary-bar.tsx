/**
 * Compact, persistent "INVESTIGATION" summary (product spec sections 6/12/
 * 13/14/15) — rendered above the chat input via the `promptExtras` slot so
 * it's always visible without eating most of the side panel's width.
 * Expands into the full component-health / timeline / diagnosis views.
 *
 * Renders nothing until there's something real to show (an investigation
 * has started, or evidence exists) — no placeholder/empty investigation
 * chrome for a casual one-off question.
 */
import { useChatContext } from "@aipexstudio/aipex-react/components/chatbot";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@aipexstudio/aipex-react/components/ui/collapsible";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@aipexstudio/aipex-react/components/ui/tabs";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { ComponentHealthPanel } from "./component-health-panel";
import { DiagnosisCard } from "./diagnosis-card";
import { EvidenceTimeline } from "./evidence-timeline";
import { PlanChecklist } from "./plan-checklist";
import { describeInvestigationStatus } from "./status-meta";
import { toneBadgeClass, toneDotClass } from "./tone-classes";
import { useInvestigationData } from "./use-investigation-data";

export function InvestigationSummaryBar() {
  const { sessionId, status, sendMessage } = useChatContext();
  const isActive =
    status === "streaming" ||
    status === "submitted" ||
    status === "executing_tools";
  const { investigation, evidence, clusters, componentHealth } =
    useInvestigationData(sessionId, isActive);
  const [open, setOpen] = useState(false);

  const hasContent = Boolean(investigation) || evidence.length > 0;
  if (!hasContent) {
    return null;
  }

  const meta = describeInvestigationStatus(investigation?.status ?? "idle");
  const warningCount = componentHealth.filter(
    (c) => c.state === "warning" || c.state === "error",
  ).length;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mb-2 overflow-hidden rounded-lg border bg-card shadow-sm"
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
        aria-label={`Investigation status: ${meta.label}. ${evidence.length} evidence items collected${warningCount > 0 ? `, ${warningCount} component warnings` : ""}. Click to ${open ? "collapse" : "expand"}.`}
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            toneDotClass(meta.tone),
            meta.inProgress && "animate-pulse",
          )}
          aria-hidden="true"
        />
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Investigation
        </span>
        <span
          className={cn(
            "shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
            toneBadgeClass(meta.tone),
          )}
        >
          {meta.label}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {evidence.length} evidence
        </span>
        {warningCount > 0 && (
          <span
            className={cn(
              "ml-auto shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
              toneBadgeClass("warning"),
            )}
          >
            {warningCount} need{warningCount === 1 ? "s" : ""} attention
          </span>
        )}
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180",
            warningCount === 0 && "ml-auto",
          )}
          data-state={open ? "open" : "closed"}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden border-t px-2 pb-2 pt-2 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out data-[state=open]:fade-in data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 duration-200">
        {investigation?.userProblem && (
          <p className="mb-2 px-1 text-xs text-muted-foreground">
            Investigating:{" "}
            <span className="text-foreground">{investigation.userProblem}</span>
          </p>
        )}
        <Tabs defaultValue="timeline">
          <TabsList className="grid h-9 w-full grid-cols-4 p-0.5">
            <TabsTrigger value="plan" className="px-1 text-xs">
              Plan
            </TabsTrigger>
            <TabsTrigger value="timeline" className="px-1 text-xs">
              Timeline
            </TabsTrigger>
            <TabsTrigger value="components" className="px-1 text-xs">
              Components
            </TabsTrigger>
            <TabsTrigger value="diagnosis" className="px-1 text-xs">
              Diagnosis
            </TabsTrigger>
          </TabsList>
          <TabsContent value="plan" className="max-h-64 overflow-y-auto">
            <PlanChecklist plan={investigation?.plan} />
          </TabsContent>
          <TabsContent value="timeline" className="max-h-64 overflow-y-auto">
            <EvidenceTimeline clusters={clusters} />
          </TabsContent>
          <TabsContent value="components" className="max-h-64 overflow-y-auto">
            <ComponentHealthPanel components={componentHealth} />
          </TabsContent>
          <TabsContent value="diagnosis" className="max-h-64 overflow-y-auto">
            <DiagnosisCard
              investigation={investigation}
              onVerify={() =>
                void sendMessage(
                  "Please verify the current diagnosis by re-checking the relevant evidence.",
                )
              }
            />
          </TabsContent>
        </Tabs>
      </CollapsibleContent>
    </Collapsible>
  );
}
