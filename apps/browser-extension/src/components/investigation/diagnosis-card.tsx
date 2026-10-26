/**
 * Diagnosis card (product spec section 15) — renders the investigation's
 * `diagnosis`/`confidence` exactly as the agent recorded them via
 * `update_investigation`. Never upgrades a "likely" diagnosis to look
 * confirmed, and never fabricates a diagnosis when none has been recorded.
 *
 * Laid out as a short narrative — what happened, why, what to do next —
 * using only fields the investigation session already carries
 * (`diagnosis`, `suspectedComponents`, `hypotheses` with their evidence id
 * counts, `verificationAttempts`). Confidence differs by visual weight, not
 * colour alone: a solid badge for confirmed, tinted for likely, outlined for
 * possible and dashed for unknown, each with its own icon and word, so the
 * verdict can never read as more certain than the data states.
 */

import type {
  DiagnosisConfidence,
  InvestigationSession,
} from "@apty/browser-runtime";
import { Badge, StatusBadge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import {
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  ShieldQuestionIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import {
  badgeTone,
  describeAptyComponent,
  describeHypothesisStatus,
} from "./status-meta";

type Weight = "solid" | "tinted" | "outlined" | "dashed";

const CONFIDENCE_META: Record<
  DiagnosisConfidence,
  {
    label: TranslationKey;
    description: TranslationKey;
    weight: Weight;
    className: string;
    Icon: ComponentType<{ className?: string }>;
  }
> = {
  confirmed: {
    label: "investigation.diagnosis.confirmed",
    description: "investigation.diagnosis.confirmedDescription",
    weight: "solid",
    className: "border-transparent bg-success text-success-foreground",
    Icon: CircleCheckIcon,
  },
  likely: {
    label: "investigation.diagnosis.likely",
    description: "investigation.diagnosis.likelyDescription",
    weight: "tinted",
    className: "border-transparent bg-warning-muted text-warning",
    Icon: TriangleAlertIcon,
  },
  possible: {
    label: "investigation.diagnosis.possible",
    description: "investigation.diagnosis.possibleDescription",
    weight: "outlined",
    className: "border-warning bg-transparent text-warning",
    Icon: CircleHelpIcon,
  },
  unknown: {
    label: "investigation.diagnosis.unknown",
    description: "investigation.diagnosis.unknownDescription",
    weight: "dashed",
    className:
      "border-dashed border-input bg-transparent text-muted-foreground",
    Icon: ShieldQuestionIcon,
  },
};

/** The confidence as the agent recorded it, in its own visual weight. */
export function ConfidenceBadge({
  confidence,
}: {
  confidence: DiagnosisConfidence;
}) {
  const { t } = useTranslation();
  const meta = CONFIDENCE_META[confidence];
  return (
    <Badge
      data-weight={meta.weight}
      className={cn("h-6 gap-1.5 rounded-full px-2.5", meta.className)}
    >
      <meta.Icon aria-hidden="true" />
      {t(meta.label)}
    </Badge>
  );
}

const OUTCOME_META: Record<
  "confirmed" | "not_confirmed" | "inconclusive",
  {
    label: TranslationKey;
    className: string;
    Icon: ComponentType<{ className?: string }>;
  }
> = {
  confirmed: {
    label: "investigation.diagnosis.outcomeConfirmed",
    className: "text-success",
    Icon: CircleCheckIcon,
  },
  not_confirmed: {
    label: "investigation.diagnosis.outcomeNotConfirmed",
    className: "text-destructive",
    Icon: CircleXIcon,
  },
  inconclusive: {
    label: "investigation.diagnosis.outcomeInconclusive",
    className: "text-muted-foreground",
    Icon: CircleHelpIcon,
  },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-3">
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      {children}
    </section>
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
      <p className="py-2 text-sm text-muted-foreground">
        {t("investigation.diagnosis.none")}
      </p>
    );
  }

  const confidence = investigation.confidence ?? "unknown";
  const attempts = investigation.verificationAttempts;
  const lastAttempt = attempts[attempts.length - 1];
  const outcome = lastAttempt ? OUTCOME_META[lastAttempt.outcome] : undefined;

  return (
    <article className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <ConfidenceBadge confidence={confidence} />
        <p className="text-xs text-muted-foreground">
          {t(CONFIDENCE_META[confidence].description)}
        </p>
      </div>

      <div className="space-y-1">
        <h4 className="text-xs text-muted-foreground">
          {t("investigation.diagnosis.whatHappened")}
        </h4>
        <p className="text-title font-semibold text-foreground">
          {investigation.diagnosis}
        </p>
        {investigation.suspectedComponents.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {`${t("investigation.diagnosis.suspected")} `}
            <span>
              {investigation.suspectedComponents
                .map((c) => describeAptyComponent(c, t))
                .join(", ")}
            </span>
          </p>
        )}
      </div>

      {investigation.hypotheses.length > 0 && (
        <Section title={t("investigation.diagnosis.why")}>
          <ul className="space-y-3">
            {investigation.hypotheses.map((hypothesis) => {
              const statusMeta = describeHypothesisStatus(hypothesis.status, t);
              const supporting = hypothesis.supportingEvidenceIds.length;
              const contradicting = hypothesis.contradictingEvidenceIds.length;
              return (
                <li key={hypothesis.id} className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm text-foreground">
                      {hypothesis.statement}
                    </span>
                    <StatusBadge tone={badgeTone(statusMeta.tone)}>
                      {statusMeta.label}
                    </StatusBadge>
                  </div>
                  {(supporting > 0 || contradicting > 0) && (
                    <p className="text-xs text-muted-foreground">
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
        </Section>
      )}

      <Section title={t("investigation.diagnosis.next")}>
        {outcome && (
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm",
              outcome.className,
            )}
          >
            <outcome.Icon aria-hidden="true" className="size-4 shrink-0" />
            {t(outcome.label)}
          </p>
        )}
        <Button variant="secondary" onClick={onVerify} className="w-full">
          {t("investigation.diagnosis.verify")}
        </Button>
      </Section>
    </article>
  );
}
