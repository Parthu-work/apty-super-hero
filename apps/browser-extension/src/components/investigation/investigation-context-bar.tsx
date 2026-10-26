/**
 * Browser context bar + live investigation banner (product spec sections 8
 * & 9 & 24). Rendered inside the header, below the title row.
 *
 * Shows a quiet "what tab is this debugging" line most of the time, and
 * switches to a prominent "LIVE INVESTIGATION" banner (with a real Stop
 * action) only while an `InvestigationSession` is actually in progress —
 * never a fabricated "Investigating..." state.
 */

import { stopInvestigation } from "@apty/browser-runtime";
import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@apty/ui/components/ui/dialog";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { CheckIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { navigationStore, useNavigation } from "../../state/navigation-store";
import { SetupBadge } from "../connections/setup-badge";
import { useReadiness } from "../connections/use-readiness";
import { describeInvestigationStatus, isTerminalStatus } from "./status-meta";
import { toneBadgeClass, toneDotClass, toneTextClass } from "./tone-classes";
import { useInvestigationData } from "./use-investigation-data";

/** The quiet bar ends with the setup badge, which opens Connections (whose own header shows the count). */
export function InvestigationContextBar() {
  const { sessionId, status, interrupt } = useChatContext();
  const { t } = useTranslation();
  const isActive =
    status === "streaming" ||
    status === "submitted" ||
    status === "executing_tools";
  const { target, setupCount } = useReadiness();
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

  if (!isLive) {
    const StateIcon = target.checking
      ? LoaderIcon
      : target.inspectable
        ? CheckIcon
        : TriangleAlertIcon;
    return (
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
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
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {target.hostname ?? (target.checking ? "" : t("shell.noPage"))}
        </span>
        {target.title && (
          <span className="min-w-0 flex-1 truncate text-small text-muted-foreground">
            {target.title}
          </span>
        )}
        {setupCount > 0 && page !== "connections" && (
          <span className="ml-auto shrink-0">
            <SetupBadge
              count={setupCount}
              onClick={() => navigationStore.openPage("connections")}
            />
          </span>
        )}
      </div>
    );
  }

  const meta = describeInvestigationStatus(investigation.status);

  return (
    <div className="animate-in fade-in slide-in-from-top-1 border-b bg-muted/20 px-4 py-2.5 duration-200 motion-reduce:animate-none">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
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
                "rounded-sm border px-1.5 py-0.5 text-xs font-semibold",
                toneBadgeClass(meta.tone),
              )}
            >
              {t("investigation.live")}
            </span>
          </div>
          {target.hostname && (
            <p className="truncate text-sm font-medium text-foreground">
              {target.hostname}
            </p>
          )}
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {investigation.userProblem}
          </p>
          <p className={cn("text-xs font-medium", toneTextClass(meta.tone))}>
            {meta.label}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => setConfirmOpen(true)}
        >
          {t("common.stop")}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("investigation.stopTitle")}</DialogTitle>
            <DialogDescription>
              {t("investigation.stopDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void handleStop()}>
              {t("common.stop")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
