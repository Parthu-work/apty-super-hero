/**
 * Automation Mode Toolbar - Focus/Background mode switcher
 *
 * Integrates with the input toolbar to allow users to switch between
 * focus mode (visual feedback, window focus) and background mode (silent operation)
 */

import {
  type AutomationMode,
  STORAGE_KEYS,
  validateAutomationMode,
} from "@apty/agent-core";
import { useStorage } from "@apty/browser-runtime/hooks";
import type { InputToolbarSlotProps } from "@apty/ui";
import { TokenUsageIndicator } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@apty/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@apty/ui/components/ui/tooltip";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import {
  CheckIcon,
  EyeIcon,
  Loader2Icon,
  MoonIcon,
  SendIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useMemo } from "react";

/**
 * AutomationModeInputToolbar - Combines automation mode selector with submit button
 */
export function AutomationModeInputToolbar({
  status,
  onStop,
  onSubmit,
}: InputToolbarSlotProps) {
  const { t } = useTranslation();
  const [automationModeRaw, setAutomationMode, isLoadingMode] =
    useStorage<string>(STORAGE_KEYS.AUTOMATION_MODE, "focus");

  const automationMode: AutomationMode = useMemo(
    () => validateAutomationMode(automationModeRaw),
    [automationModeRaw],
  );

  // Determine submit button state
  let submitIcon = <SendIcon className="size-4" />;
  let submitLabel = "Send";

  if (status === "submitted") {
    submitIcon = <Loader2Icon className="size-4 animate-spin" />;
    submitLabel = "Sending...";
  } else if (status === "streaming") {
    submitIcon = <SquareIcon className="size-4" />;
    submitLabel = "Stop";
  } else if (status === "error") {
    submitIcon = <XIcon className="size-4" />;
    submitLabel = "Error";
  }

  const handleSubmitClick = () => {
    if (status === "streaming") {
      onStop?.();
    } else {
      onSubmit?.();
    }
  };

  return (
    <div className="flex items-center gap-1">
      {/* Token Usage Indicator - compact mode next to automation mode */}
      <TokenUsageIndicator compact />

      {/* Automation Mode Selector */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 transition-colors duration-200",
                  automationMode === "focus"
                    ? "text-primary hover:text-primary/90"
                    : "text-muted-foreground hover:text-foreground",
                )}
                disabled={isLoadingMode}
              >
                {automationMode === "focus" ? (
                  <EyeIcon className="size-4" />
                ) : (
                  <MoonIcon className="size-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">
              {t(automationMode === "focus" ? "mode.focus" : "mode.background")}
            </p>
            <p className="text-xs opacity-80">{t("mode.selectMode")}</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onClick={() => setAutomationMode("focus")}
            className={cn(
              "cursor-pointer",
              automationMode === "focus" && "bg-accent",
            )}
          >
            <div className="flex items-start gap-2 py-1">
              <EyeIcon className="size-4 mt-0.5 text-primary" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{t("mode.focus")}</span>
                  {automationMode === "focus" && (
                    <CheckIcon className="size-3.5 text-primary" />
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("mode.focusDescription")}
                </span>
              </div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setAutomationMode("background")}
            className={cn(
              "cursor-pointer",
              automationMode === "background" && "bg-accent",
            )}
          >
            <div className="flex items-start gap-2 py-1">
              <MoonIcon className="size-4 mt-0.5 text-muted-foreground" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    {t("mode.background")}
                  </span>
                  {automationMode === "background" && (
                    <CheckIcon className="size-3.5 text-primary" />
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("mode.backgroundDescription")}
                </span>
              </div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Submit Button */}
      <Button
        aria-label={submitLabel}
        className="gap-1.5 rounded-lg"
        size="icon"
        type={status === "streaming" ? "button" : "submit"}
        variant="default"
        onClick={status === "streaming" ? handleSubmitClick : undefined}
      >
        {submitIcon}
      </Button>
    </div>
  );
}
