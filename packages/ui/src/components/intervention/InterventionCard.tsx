/**
 * Intervention Card
 *
 * The frame every intervention shares: an icon, the title and its status,
 * the reason, the body, and the time limit while it waits.
 */

import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useTranslation } from "../../i18n/hooks.js";
import type { TranslationKey } from "../../i18n/types.js";
import { cn } from "../../lib/utils.js";
import { StatusBadge, type StatusTone } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export type InterventionStatus =
  | "pending"
  | "active"
  | "completed"
  | "cancelled"
  | "timeout"
  | "error";

export type InterventionMode = "disabled" | "passive";

interface InterventionCardProps {
  status: InterventionStatus;
  title: string;
  reason?: string;
  timeout?: number;
  onCancel?: () => void;
  children?: React.ReactNode;
}

const STATUS: Record<
  InterventionStatus,
  {
    tone: StatusTone;
    Icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
  }
> = {
  pending: { tone: "warning", Icon: ClockIcon, iconClass: "text-warning" },
  active: { tone: "info", Icon: ClockIcon, iconClass: "text-info" },
  completed: {
    tone: "success",
    Icon: CheckCircleIcon,
    iconClass: "text-success",
  },
  cancelled: {
    tone: "neutral",
    Icon: XIcon,
    iconClass: "text-muted-foreground",
  },
  timeout: {
    tone: "warning",
    Icon: AlertCircleIcon,
    iconClass: "text-warning",
  },
  error: {
    tone: "danger",
    Icon: AlertCircleIcon,
    iconClass: "text-destructive",
  },
};

export const InterventionCard: React.FC<InterventionCardProps> = ({
  status,
  title,
  reason,
  timeout,
  onCancel,
  children,
}) => {
  const { t } = useTranslation();
  const { tone, Icon, iconClass } = STATUS[status];
  const isActive = status === "active" || status === "pending";

  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-start gap-3 p-4">
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 size-5 shrink-0", iconClass)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-title font-semibold text-foreground">
              {title}
            </h3>
            <StatusBadge
              tone={tone}
              indicator={status === "active" ? "spinner" : undefined}
            >
              {t(`interventions.status.${status}` as TranslationKey)}
            </StatusBadge>
          </div>
          {reason && (
            <p className="mt-1 text-sm text-muted-foreground">{reason}</p>
          )}
        </div>
        {isActive && onCancel && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label={t("common.cancel")}
            className="shrink-0"
          >
            <XIcon aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="border-t border-border p-4">{children}</div>

      {isActive && timeout && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <ClockIcon aria-hidden="true" className="size-3.5" />
          <span>
            {t("interventions.common.timeoutLabel" as TranslationKey)}:{" "}
            {timeout} {t("interventions.common.timeoutUnit" as TranslationKey)}
          </span>
        </div>
      )}
    </section>
  );
};
