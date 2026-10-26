/**
 * Intervention Mode Toggle
 *
 * Intervention mode switch button at the top of conversation
 *
 * Features:
 * - Switch intervention mode (disabled/passive)
 * - Save to current conversation state
 * - Clear visual indication
 * - Cancel all ongoing interventions when switching to disabled
 */

import type React from "react";
import { useTranslation } from "../../i18n/hooks.js";
import type { TranslationKey } from "../../i18n/types.js";
import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";

export type InterventionMode = "disabled" | "passive";

interface InterventionModeToggleProps {
  mode: InterventionMode;
  onChange: (mode: InterventionMode) => void;
  className?: string;
}

const MODE_BASE_CONFIG = {
  disabled: {
    icon: "🚫",
    color: "text-muted-foreground",
    bgColor: "bg-muted hover:bg-accent",
  },
  passive: {
    icon: "🤝",
    color: "text-info",
    bgColor: "bg-info-muted hover:bg-info-muted/80",
  },
};

export const InterventionModeToggle: React.FC<InterventionModeToggleProps> = ({
  mode,
  onChange,
  className = "",
}) => {
  const { t } = useTranslation();
  const currentBaseConfig = MODE_BASE_CONFIG[mode];

  const handleModeChange = (newMode: InterventionMode) => {
    if (newMode === mode) return;

    // Notify parent component (which will handle intervention manager update)
    onChange(newMode);
  };

  const getModeLabel = (modeKey: InterventionMode) => {
    return t(`interventions.mode.${modeKey}` as TranslationKey);
  };

  const getModeDescription = (modeKey: InterventionMode) => {
    return t(`interventions.mode.${modeKey}Description` as TranslationKey);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`${currentBaseConfig.bgColor} ${currentBaseConfig.color} border-none ${className}`}
        >
          <span className="mr-1">{currentBaseConfig.icon}</span>
          <span className="font-medium">{getModeLabel(mode)}</span>
          <svg
            className="ml-1 w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {(Object.keys(MODE_BASE_CONFIG) as InterventionMode[]).map(
          (modeKey) => {
            const baseConfig = MODE_BASE_CONFIG[modeKey];
            const isSelected = modeKey === mode;

            return (
              <DropdownMenuItem
                key={modeKey}
                onClick={() => handleModeChange(modeKey)}
                className={`cursor-pointer ${isSelected ? "bg-accent" : ""}`}
              >
                <div className="flex items-start gap-2 py-1">
                  <span className="text-title mt-0.5">{baseConfig.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {getModeLabel(modeKey)}
                      </span>
                      {isSelected && (
                        <span className="text-xs text-info">✓</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {getModeDescription(modeKey)}
                    </span>
                  </div>
                </div>
              </DropdownMenuItem>
            );
          },
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
