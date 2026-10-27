/**
 * Monitor operation card
 *
 * Asks the user to click on the page, then says whether the click was
 * captured.
 */

import { MousePointerClickIcon } from "lucide-react";
import type React from "react";
import { useTranslation } from "../../i18n/hooks.js";
import type { TranslationKey } from "../../i18n/types.js";
import { Notice } from "../ui/notice.js";
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
        <Notice tone="info" icon={MousePointerClickIcon}>
          <p className="font-medium">
            {t("interventions.monitor.clickPrompt" as TranslationKey)}
          </p>
          <p className="mt-1 text-small text-muted-foreground">
            {t("interventions.monitor.captureInfo" as TranslationKey)}
          </p>
        </Notice>
      )}

      {status === "completed" && (
        <Notice
          tone="success"
          title={t("interventions.monitor.captured" as TranslationKey)}
        >
          {t("interventions.monitor.capturedSuccess" as TranslationKey)}
        </Notice>
      )}

      {status === "cancelled" && (
        <p className="text-sm text-muted-foreground">
          {t("interventions.monitor.cancelled" as TranslationKey)}
        </p>
      )}

      {status === "timeout" && (
        <Notice tone="warning">
          {t("interventions.monitor.timeout" as TranslationKey)}
        </Notice>
      )}

      {status === "error" && (
        <Notice tone="error">
          {t("interventions.monitor.error" as TranslationKey)}
        </Notice>
      )}
    </InterventionCard>
  );
};
