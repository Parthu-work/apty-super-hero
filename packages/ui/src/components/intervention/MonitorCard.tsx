/**
 * Monitor Operation Card
 *
 * Clean and colorful operation monitoring card
 */

import { MousePointerClickIcon } from "lucide-react";
import type React from "react";
import { useTranslation } from "../../i18n/hooks.js";
import type { TranslationKey } from "../../i18n/types.js";
import type { InterventionStatus } from "./InterventionCard.js";
import { InterventionCard } from "./InterventionCard.js";

interface MonitorCardProps {
  status: InterventionStatus;
  reason?: string;
  timeout?: number;
  onCancel?: () => void;
}

export const MonitorCard: React.FC<MonitorCardProps> = ({
  status,
  reason,
  timeout,
  onCancel,
}) => {
  const { t } = useTranslation();
  const isActive = status === "active" || status === "pending";

  return (
    <InterventionCard
      status={status}
      title={t("interventions.monitor.title" as TranslationKey)}
      reason={reason}
      timeout={timeout}
      onCancel={onCancel}
    >
      {isActive && (
        <div className="space-y-4">
          {/* Click indicator animation */}
          <div className="relative bg-info-muted rounded-xl p-8 overflow-hidden">
            {/* Pulse rings */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                <span
                  className="absolute inline-flex h-20 w-20 rounded-full bg-info opacity-20 animate-ping motion-reduce:animate-none"
                  style={{ animationDuration: "2s" }}
                />
                <span
                  className="absolute inline-flex h-16 w-16 top-2 left-2 rounded-full bg-info opacity-30 animate-ping motion-reduce:animate-none"
                  style={{ animationDuration: "1.5s" }}
                />
              </div>
            </div>

            {/* Center icon */}
            <div className="relative flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-card shadow-lg flex items-center justify-center ring-4 ring-info/20">
                <MousePointerClickIcon className="w-7 h-7 text-info animate-pulse motion-reduce:animate-none" />
              </div>
            </div>
          </div>

          {/* Hint information */}
          <div className="space-y-3">
            <div className="text-sm text-center font-medium text-foreground bg-info-muted rounded-xl px-4 py-3">
              👆 {t("interventions.monitor.clickPrompt" as TranslationKey)}
            </div>

            <div className="text-xs text-center text-muted-foreground bg-muted rounded-lg py-2.5">
              {t("interventions.monitor.captureInfo" as TranslationKey)}
            </div>
          </div>
        </div>
      )}

      {status === "completed" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-success font-medium">
            <svg
              className="w-4 h-4"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            {t("interventions.monitor.captured" as TranslationKey)}
          </div>
          <div className="bg-success-muted border border-success/40 rounded-xl p-4">
            <div className="text-sm text-foreground">
              {t("interventions.monitor.capturedSuccess" as TranslationKey)}
            </div>
          </div>
        </div>
      )}

      {status === "cancelled" && (
        <div className="text-sm text-muted-foreground text-center py-4">
          {t("interventions.monitor.cancelled" as TranslationKey)}
        </div>
      )}

      {status === "timeout" && (
        <div className="text-sm text-warning text-center py-4">
          {t("interventions.monitor.timeout" as TranslationKey)}
        </div>
      )}

      {status === "error" && (
        <div className="text-sm text-destructive text-center py-4">
          {t("interventions.monitor.error" as TranslationKey)}
        </div>
      )}
    </InterventionCard>
  );
};
