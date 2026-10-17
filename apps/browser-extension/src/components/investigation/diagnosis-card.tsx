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

import type {
  DiagnosisConfidence,
  InvestigationSession,
} from "@apty/browser-runtime";
import { Badge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
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
    label: TranslationKey;
    description: TranslationKey;
    badgeClassName: string;
    Icon: ComponentType<{ className?: string }>;
  }
> = {
  confirmed: {
    label: "investigation.diagnosis.confirmed",
    description: "investigation.diagnosis.confirmedDescription",
    badgeClassName: "border-transparent bg-success text-success-foreground",
    Icon: CheckCircle2Icon,
  },
  likely: {
    label: "investigation.diagnosis.likely",
    description: "investigation.diagnosis.likelyDescription",
    badgeClassName: "border-transparent bg-warning/20 text-warning",
    Icon: TriangleAlertIcon,
  },
  possible: {
    label: "investigation.diagnosis.possible",
    description: "investigation.diagnosis.possibleDescription",
    badgeClassName: "border-warning/40 bg-transparent text-warning",
    Icon: CircleHelpIcon,
  },
  unknown: {
    label: "investigation.diagnosis.unknown",
    description: "investigation.diagnosis.unknownDescription",
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
  const { t } = useTranslation();
  if (!investigation?.diagnosis) {
    return (
      <p className="px-2 py-4 text-center text-sm text-muted-foreground">
        {t("investigation.diagnosis.none")}
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
          {t(meta.label)}
        </Badge>
        <p className="text-xs text-muted-foreground">{t(meta.description)}</p>
      </div>

      <div>
        <SectionLabel>{t("investigation.diagnosis.whatHappened")}</SectionLabel>
        <p className="text-sm font-medium leading-snug">
          {investigation.diagnosis}
        </p>
        {investigation.suspectedComponents.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            <span>{`${t("investigation.diagnosis.suspected")} `}</span>
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
          <SectionLabel>{t("investigation.diagnosis.why")}</SectionLabel>
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
                      {t("investigation.diagnosis.evidenceSupporting", {
                        count: supporting,
                      })}
                      {contradicting > 0 &&
                        t("investigation.diagnosis.evidenceContradicting", {
                          count: contradicting,
                        })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-1.5 border-t pt-2">
        <SectionLabel>{t("investigation.diagnosis.next")}</SectionLabel>
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
              {lastAttempt.outcome === "confirmed" &&
                t("investigation.diagnosis.outcomeConfirmed")}
              {lastAttempt.outcome === "not_confirmed" &&
                t("investigation.diagnosis.outcomeNotConfirmed")}
              {lastAttempt.outcome === "inconclusive" &&
                t("investigation.diagnosis.outcomeInconclusive")}
            </span>
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={onVerify}
          className="w-full"
        >
          {t("investigation.diagnosis.verify")}
        </Button>
      </div>
    </div>
  );
}
