/**
 * The header's one context line (KB-RAG K29, L1; product spec sections 8,
 * 9 and 24): what the tab is, the case chip, the site's Apty version and the
 * setup badge. While an `InvestigationSession` is actually in progress the
 * same line leads with LIVE, its status and a real Stop action, never a
 * fabricated "Investigating..." state. Its plan, components and timeline
 * open in the chat, not here.
 */

import { stopInvestigation } from "@apty/browser-runtime";
import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { ConfirmDialog } from "@apty/ui/components/ui/confirm-dialog";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { CheckIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { navigationStore, useNavigation } from "../../state/navigation-store";
import { CaseChip } from "../cases/case-chip";
import { useSiteLabels } from "../cases/use-site-label";
import { SetupBadge } from "../connections/setup-badge";
import { useReadiness } from "../connections/use-readiness";
import { KbVersionChip } from "./kb-version-chip";
import { describeInvestigationStatus, isTerminalStatus } from "./status-meta";
import { toneBadgeClass, toneDotClass, toneTextClass } from "./tone-classes";
import { useInvestigationData } from "./use-investigation-data";

function TabState() {
  const { t } = useTranslation();
  const { target } = useReadiness();
  const StateIcon = target.checking
    ? LoaderIcon
    : target.inspectable
      ? CheckIcon
      : TriangleAlertIcon;
  return (
    <>
      <StateIcon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          target.checking
            ? "text-muted-foreground"
            : target.inspectable
              ? "text-success"
              : "text-warning",
        )}
      />
      <span className="sr-only">
        {t(
          target.checking
            ? "readiness.state.checking"
            : target.inspectable
              ? "shell.canInspect"
              : "shell.cantInspect",
        )}
      </span>
    </>
  );
}

/** The quiet line ends with the setup badge, which opens Connections (whose own header shows the count). */
export function InvestigationContextBar() {
  const { sessionId, status, interrupt } = useChatContext();
  const { t } = useTranslation();
  const isActive =
    status === "streaming" ||
    status === "submitted" ||
    status === "executing_tools";
  const { target, setupCount } = useReadiness();
  const { label: siteLabel } = useSiteLabels();
  const { page } = useNavigation();
  const { investigation } = useInvestigationData(sessionId, isActive);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [, forceRerender] = useState(0);

  const isLive = investigation && !isTerminalStatus(investigation.status);

  const handleStop = async () => {
    setConfirmOpen(false);
    try {
      await interrupt();
    } catch {
      // Best-effort — stopping the investigation record below is what matters.
    }
    stopInvestigation(sessionId ?? undefined, "stopped");
    // The investigation store lives outside React state, so nudge a
    // re-render to reflect the now-stopped status immediately rather than
    // waiting for the summary bar's next poll tick.
    forceRerender((n) => n + 1);
  };

  const site =
    siteLabel(target.hostname ?? undefined) ??
    (target.checking
      ? ""
      : t(target.tabId === null ? "shell.noPage" : "shell.thisPage"));
  const meta = isLive
    ? describeInvestigationStatus(investigation.status, t)
    : undefined;

  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3",
        isLive && "bg-muted/20",
      )}
      data-testid="context-line"
    >
      {meta ? (
        <>
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              toneDotClass(meta.tone),
              meta.inProgress && "animate-pulse motion-reduce:animate-none",
            )}
            aria-hidden="true"
          />
          <span
            className={cn(
              "shrink-0 rounded-sm border px-1.5 py-0.5 text-xs font-semibold",
              toneBadgeClass(meta.tone),
            )}
          >
            {t("investigation.live")}
          </span>
          <span
            className={cn(
              "min-w-0 shrink truncate text-xs font-medium",
              toneTextClass(meta.tone),
            )}
            title={investigation?.userProblem}
          >
            {meta.label}
          </span>
        </>
      ) : (
        <TabState />
      )}
      <span
        className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
        title={target.title ?? undefined}
        data-testid="context-site"
      >
        {site}
      </span>
      <KbVersionChip host={target.hostname ?? undefined} />
      <CaseChip />
      {meta ? (
        <Button
          size="sm"
          variant="secondary"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => setConfirmOpen(true)}
        >
          {t("common.stop")}
        </Button>
      ) : (
        setupCount > 0 &&
        page !== "connections" && (
          <span className="shrink-0">
            <SetupBadge
              count={setupCount}
              onClick={() => navigationStore.openPage("connections")}
            />
          </span>
        )
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("investigation.stopTitle")}
        description={t("investigation.stopDescription")}
        confirmLabel={t("common.stop")}
        onConfirm={() => void handleStop()}
      />
    </div>
  );
}
