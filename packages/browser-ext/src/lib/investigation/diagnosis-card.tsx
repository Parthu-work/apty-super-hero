/**
 * Diagnosis card (product spec section 15) — renders the investigation's
 * `diagnosis`/`confidence` exactly as the agent recorded them via
 * `update_investigation`. Never upgrades a "likely" diagnosis to look
 * confirmed, and never fabricates a diagnosis when none has been recorded.
 *
 * Laid out as a short narrative — what happened, why, what backs it, what to
 * do next — using only fields the investigation session already carries
 * (`diagnosis`, `suspectedComponents`, `hypotheses` with their evidence id
 * counts, `verificationAttempts`). Confidence is rendered with visibly
 * different weight per level (a solid, filled badge for CONFIRMED down to a
 * dashed, muted one for UNKNOWN) so the verdict can never read as more
 * certain than the data actually states.
 */
import { Badge } from "@aipexstudio/aipex-react/components/ui/badge";
import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import type {
  DiagnosisConfidence,
  InvestigationSession,
} from "@aipexstudio/browser-runtime";
import {
  CheckCircle2Icon,
  CircleHelpIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { describeAptyComponent, describeHypothesisStatus } from "./status-meta";
import { toneTextClass } from "./tone-classes";

const CONFIDENCE_META: Record<
  DiagnosisConfidence,
  {
    label: string;
    description: string;
    badgeClassName: string;
    Icon: ComponentType<{ className?: string }>;
  }
> = {
  confirmed: {
    label: "CONFIRMED",
    description: "Confirmed by a successful verification check.",
    badgeClassName: "border-transparent bg-success text-success-foreground",
    Icon: CheckCircle2Icon,
  },
  likely: {
    label: "LIKELY",
    description:
      "Strong evidence points here, but it hasn't been independently verified.",
    badgeClassName: "border-transparent bg-warning/20 text-warning",
    Icon: TriangleAlertIcon,
  },
  possible: {
    label: "POSSIBLE",
    description:
      "One plausible explanation among others — treat as a lead, not a conclusion.",
    badgeClassName: "border-warning/40 bg-transparent text-warning",
    Icon: CircleHelpIcon,
  },
  unknown: {
    label: "UNKNOWN",
    description: "Not enough evidence yet to point to a cause.",
    badgeClassName:
      "border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground",
    Icon: ShieldQuestionIcon,
  },
};

function SectionLabel({ children }: { children: string }) {
  return (
    <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  );
}

export function DiagnosisCard({
  investigation,
  onVerify,
}: {
  investigation: InvestigationSession | undefined;
  onVerify: () => void;
}) {
  if (!investigation?.diagnosis) {
    return (
      <p className="px-2 py-4 text-center text-sm text-muted-foreground">
        No diagnosis yet. The agent records one here once it reaches a
        conclusion backed by evidence.
      </p>
    );
  }

  const confidence = investigation.confidence ?? "unknown";
  const meta = CONFIDENCE_META[confidence];
  const attempts = investigation.verificationAttempts;
  const lastAttempt = attempts[attempts.length - 1];

  return (
    <div className="space-y-3 rounded-md border p-2">
      <div className="flex items-start gap-2">
        <Badge className={cn("gap-1 shrink-0", meta.badgeClassName)}>
          <meta.Icon className="size-3" />
          {meta.label}
        </Badge>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>

      <div>
        <SectionLabel>What happened</SectionLabel>
        <p className="text-sm font-medium leading-snug">
          {investigation.diagnosis}
        </p>
        {investigation.suspectedComponents.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            <span>Suspected: </span>
            <span>
              {investigation.suspectedComponents
                .map((c) => describeAptyComponent(c))
                .join(", ")}
            </span>
          </p>
        )}
      </div>

      {investigation.hypotheses.length > 0 && (
        <div>
          <SectionLabel>Why · hypotheses considered</SectionLabel>
          <ul className="space-y-1.5">
            {investigation.hypotheses.map((hypothesis) => {
              const statusMeta = describeHypothesisStatus(hypothesis.status);
              const supporting = hypothesis.supportingEvidenceIds.length;
              const contradicting = hypothesis.contradictingEvidenceIds.length;
              return (
                <li key={hypothesis.id} className="text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground">
                      {hypothesis.statement}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium",
                        toneTextClass(statusMeta.tone),
                      )}
                    >
                      {statusMeta.label}
                    </span>
                  </div>
                  {(supporting > 0 || contradicting > 0) && (
                    <p className="text-[11px] text-muted-foreground">
                      Evidence: {supporting} supporting
                      {contradicting > 0 && `, ${contradicting} contradicting`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-1.5 border-t pt-2">
        <SectionLabel>What to do next</SectionLabel>
        {lastAttempt && (
          <div className="flex items-center gap-1.5 text-xs">
            <ShieldCheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className={
                lastAttempt.outcome === "confirmed"
                  ? toneTextClass("success")
                  : lastAttempt.outcome === "not_confirmed"
                    ? toneTextClass("danger")
                    : toneTextClass("neutral")
              }
            >
              {lastAttempt.outcome === "confirmed" && "Diagnosis confirmed"}
              {lastAttempt.outcome === "not_confirmed" &&
                "Diagnosis not confirmed by last check"}
              {lastAttempt.outcome === "inconclusive" &&
                "Last verification was inconclusive"}
            </span>
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={onVerify}
          className="w-full"
        >
          Verify diagnosis
        </Button>
      </div>
    </div>
  );
}
