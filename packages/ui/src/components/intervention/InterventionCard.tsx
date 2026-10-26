/**
 * Intervention Card
 *
 * Modern intervention card container
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
import { Button } from "../ui/button.js";

export type InterventionStatus =
  | "pending"
  | "active"
  | "completed"
  | "cancelled"
  | "timeout"
  | "error";

interface InterventionCardProps {
  status: InterventionStatus;
  title: string;
  reason?: string;
  timeout?: number;
  onCancel?: () => void;
  children?: React.ReactNode;
}

const STATUS_BASE_CONFIG = {
  pending: {
    icon: ClockIcon,
    accentColor: "bg-warning",
    iconBg: "bg-warning-muted",
    iconColor: "text-warning",
    badgeBg: "bg-warning-muted",
    badgeText: "text-warning",
  },
  active: {
    icon: ClockIcon,
    accentColor: "bg-info",
    iconBg: "bg-info-muted",
    iconColor: "text-info",
    badgeBg: "bg-info-muted",
    badgeText: "text-info",
  },
  completed: {
    icon: CheckCircleIcon,
    accentColor: "bg-success",
    iconBg: "bg-success-muted",
    iconColor: "text-success",
    badgeBg: "bg-success-muted",
    badgeText: "text-success",
  },
  cancelled: {
    icon: XIcon,
    accentColor: "bg-subtle-foreground",
    iconBg: "bg-muted",
    iconColor: "text-muted-foreground",
    badgeBg: "bg-muted",
    badgeText: "text-muted-foreground",
  },
  timeout: {
    icon: AlertCircleIcon,
    accentColor: "bg-warning",
    iconBg: "bg-warning-muted",
    iconColor: "text-warning",
    badgeBg: "bg-warning-muted",
    badgeText: "text-warning",
  },
  error: {
    icon: AlertCircleIcon,
    accentColor: "bg-destructive",
    iconBg: "bg-destructive-muted",
    iconColor: "text-destructive",
    badgeBg: "bg-destructive-muted",
    badgeText: "text-destructive",
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
  const config = STATUS_BASE_CONFIG[status];
  const Icon = config.icon;
  const isActive = status === "active" || status === "pending";

  const getStatusLabel = () => {
    return t(`interventions.status.${status}` as TranslationKey);
  };

  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl
        bg-card
        border border-border
        shadow-sm hover:shadow-md transition-all duration-200
        ${isActive ? "animate-in slide-in-from-bottom-4" : ""}
      `}
    >
      {/* Colorful accent bar */}
      <div className={`h-1 ${config.accentColor}`} />

      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className={`p-2 rounded-xl ${config.iconBg}`}>
              <Icon className={`w-5 h-5 ${config.iconColor}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-title font-semibold text-foreground">
                  {title}
                </h3>
                <span
                  className={`
                  text-xs font-medium px-2.5 py-1 rounded-full
                  ${config.badgeBg} ${config.badgeText}
                `}
                >
                  {getStatusLabel()}
                </span>
              </div>
              {reason && (
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {reason}
                </p>
              )}
            </div>
          </div>
          {isActive && onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              aria-label={t("common.cancel")}
              className="ml-2 h-8 w-8 p-0 rounded-full hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <XIcon className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-4 bg-muted/50">{children}</div>

      {/* Footer - Timeout indicator */}
      {isActive && timeout && (
        <div className="px-5 py-3 bg-muted border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ClockIcon className="w-3.5 h-3.5" />
            <span>
              {t("interventions.common.timeoutLabel" as TranslationKey)}:{" "}
              {timeout}{" "}
              {t("interventions.common.timeoutUnit" as TranslationKey)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
