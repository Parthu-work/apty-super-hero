/**
 * Browser context bar + live investigation banner (product spec sections 8
 * & 9 & 24). Rendered inside the header, below the title row.
 *
 * Shows a quiet "what tab is this debugging" line most of the time, and
 * switches to a prominent "LIVE INVESTIGATION" banner (with a real Stop
 * action) only while an `InvestigationSession` is actually in progress —
 * never a fabricated "Investigating..." state.
 */
import { useChatContext } from "@aipexstudio/aipex-react/components/chatbot";
import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@aipexstudio/aipex-react/components/ui/dialog";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import { stopInvestigation } from "@aipexstudio/browser-runtime";
import { useState } from "react";
import { describeInvestigationStatus, isTerminalStatus } from "./status-meta";
import { toneDotClass, toneTextClass } from "./tone-classes";
import { useCurrentTarget } from "./use-current-target";
import { useInvestigationData } from "./use-investigation-data";

export function InvestigationContextBar() {
  const { sessionId, status, interrupt } = useChatContext();
  const isActive =
    status === "streaming" ||
    status === "submitted" ||
    status === "executing_tools";
  const target = useCurrentTarget(sessionId);
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

  if (!target.hostname && !isLive) {
    return null;
  }

  if (!isLive) {
    return (
      <div className="flex items-center gap-1.5 border-b bg-muted/10 px-4 py-1.5 text-xs text-muted-foreground">
        <span
          className="size-1.5 rounded-full bg-green-500"
          aria-hidden="true"
        />
        <span className="truncate">
          {target.hostname}
          {target.title ? ` — ${target.title}` : ""}
        </span>
      </div>
    );
  }

  const meta = describeInvestigationStatus(investigation.status);

  return (
    <div className="border-b bg-muted/20 px-4 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn("size-2 rounded-full", toneDotClass(meta.tone))}
              aria-hidden="true"
            />
            <span
              className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                toneTextClass(meta.tone),
              )}
            >
              Live investigation
            </span>
          </div>
          {target.hostname && (
            <p className="mt-1 truncate text-sm font-medium">
              {target.hostname}
            </p>
          )}
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {investigation.userProblem}
          </p>
          <p className={cn("mt-0.5 text-xs", toneTextClass(meta.tone))}>
            {meta.label}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => setConfirmOpen(true)}
        >
          Stop
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop investigation?</DialogTitle>
            <DialogDescription>
              Evidence collected so far will remain available in this
              conversation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleStop()}>
              Stop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
