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
import { describeInvestigationStatus } from "./status-meta";
import { toneDotClass, toneTextClass } from "./tone-classes";
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
      className="mb-2 rounded-md border bg-muted/20"
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-label={`Investigation status: ${meta.label}. ${evidence.length} evidence items collected${warningCount > 0 ? `, ${warningCount} component warnings` : ""}. Click to ${open ? "collapse" : "expand"}.`}
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            toneDotClass(meta.tone),
          )}
          aria-hidden="true"
        />
        <span className={cn("text-sm font-medium", toneTextClass(meta.tone))}>
          {meta.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {evidence.length} evidence
          {warningCount > 0 &&
            ` · ${warningCount} component${warningCount === 1 ? "" : "s"} need attention`}
        </span>
        <ChevronDownIcon
          className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180"
          data-state={open ? "open" : "closed"}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-2 pb-2 pt-2">
        {investigation?.userProblem && (
          <p className="mb-2 px-1 text-xs text-muted-foreground">
            Investigating:{" "}
            <span className="text-foreground">{investigation.userProblem}</span>
          </p>
        )}
        <Tabs defaultValue="timeline">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="components">Components</TabsTrigger>
            <TabsTrigger value="diagnosis">Diagnosis</TabsTrigger>
          </TabsList>
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
