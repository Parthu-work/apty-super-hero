import type { AgentMetrics } from "@aipexstudio/aipex-core";
import { useMemo } from "react";
import { cn } from "../../../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { useChatContext } from "../context";

// Default token thresholds for the usage meter (override via props)
const DEFAULT_WATERMARK_TOKENS = 150_000;
const DEFAULT_UI_MAX_TOKENS = 180_000;

export interface TokenUsageIndicatorProps {
  /** Custom className */
  className?: string;
  /** Compact mode for header/toolbar usage */
  compact?: boolean;
  /** Whether the conversation is currently being summarized */
  isSummarizing?: boolean;
  /** Token watermark threshold (when to show warning) */
  watermarkTokens?: number;
  /** Maximum tokens for UI display (100% mark) */
  maxTokens?: number;
  /** Override metrics (if not using context) */
  metrics?: AgentMetrics | null;
}

/**
 * Format token numbers for display (e.g., 150000 -> "150K")
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

/**
 * TokenUsageIndicator - Displays current token usage with visual progress
 *
 * Shows token consumption as a circular progress indicator with color-coded
 * thresholds. Supports compact mode for use in headers/toolbars.
 *
 * @example
 * ```tsx
 * // In a header (compact mode)
 * <TokenUsageIndicator compact />
 *
 * // Full display with custom thresholds
 * <TokenUsageIndicator
 *   watermarkTokens={100000}
 *   maxTokens={128000}
 * />
 * ```
 */
export function TokenUsageIndicator({
  className,
  compact = false,
  isSummarizing = false,
  watermarkTokens = DEFAULT_WATERMARK_TOKENS,
  maxTokens = DEFAULT_UI_MAX_TOKENS,
  metrics: metricsProp,
}: TokenUsageIndicatorProps) {
  // Get metrics from context if not provided via props
  const chatContext = useChatContext();
  const metrics = metricsProp ?? chatContext.metrics;

  const usage = useMemo(() => {
    // Use tokensUsed (total from latest response) instead of just promptTokens
    const tokens = metrics?.tokensUsed ?? 0;
    const percentage = Math.min((tokens / maxTokens) * 100, 100);
    return { tokens, percentage };
  }, [metrics, maxTokens]);

  // Hide the indicator when there's no usage data and not summarizing
  if (!isSummarizing && usage.tokens === 0) {
    return null;
  }

  // Determine color based on usage percentage
  const getColorClass = (percentage: number): string => {
    if (percentage >= 90) return "text-destructive";
    if (percentage >= (watermarkTokens / maxTokens) * 100)
      return "text-warning";
    if (percentage >= 60) return "text-warning/70";
    return "text-muted-foreground";
  };

  const getProgressColor = (percentage: number): string => {
    if (percentage >= 90) return "stroke-destructive";
    if (percentage >= (watermarkTokens / maxTokens) * 100)
      return "stroke-warning";
    if (percentage >= 60) return "stroke-warning/70";
    return "stroke-muted-foreground";
  };

  // Compact mode: only show percentage and circular progress, hover for details
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-xs cursor-default",
              "hover:bg-muted/50 rounded-md transition-colors",
              className,
            )}
          >
            {/* Circular Progress Indicator */}
            <div className="relative w-3.5 h-3.5 flex-shrink-0">
              <svg
                className="w-3.5 h-3.5 transform -rotate-90"
                viewBox="0 0 16 16"
                role="img"
                aria-label="Token usage progress"
              >
                {/* Background circle */}
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  className="text-muted-foreground/20"
                />
                {/* Progress circle */}
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeDasharray={`${2 * Math.PI * 6}`}
                  strokeDashoffset={`${2 * Math.PI * 6 * (1 - usage.percentage / 100)}`}
                  className={
                    isSummarizing
                      ? "stroke-info"
                      : getProgressColor(usage.percentage)
                  }
                  strokeLinecap="round"
                />
              </svg>
            </div>

            {/* Percentage only */}
            <span
              className={cn(
                "font-mono font-medium text-xs",
                isSummarizing ? "text-info" : getColorClass(usage.percentage),
              )}
            >
              {usage.percentage.toFixed(0)}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="flex flex-col gap-0.5">
            <div className="font-medium">Context Usage</div>
            <div className="text-muted-foreground">
              {formatTokens(usage.tokens)} / {formatTokens(maxTokens)} tokens
            </div>
            {metrics && (
              <div className="text-muted-foreground text-xs">
                Prompt: {formatTokens(metrics.promptTokens)} | Completion:{" "}
                {formatTokens(metrics.completionTokens)}
              </div>
            )}
            {isSummarizing && (
              <div className="text-info text-xs mt-1">Summarizing...</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Full mode: show all details inline
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground",
        "bg-muted/30 rounded-md border border-border/50",
        isSummarizing && "border-info/40 bg-info/10",
        className,
      )}
    >
      {/* Circular Progress Indicator */}
      <div className="relative w-4 h-4">
        <svg
          className="w-4 h-4 transform -rotate-90"
          viewBox="0 0 16 16"
          role="img"
          aria-label="Token usage progress"
        >
          {/* Background circle */}
          <circle
            cx="8"
            cy="8"
            r="6"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            className="text-muted-foreground/20"
          />
          {/* Progress circle */}
          <circle
            cx="8"
            cy="8"
            r="6"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeDasharray={`${2 * Math.PI * 6}`}
            strokeDashoffset={`${2 * Math.PI * 6 * (1 - usage.percentage / 100)}`}
            className={
              isSummarizing ? "stroke-info" : getProgressColor(usage.percentage)
            }
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Token count and percentage */}
      <div className="flex items-center gap-1">
        <span
          className={cn(
            "font-mono font-medium",
            isSummarizing ? "text-info" : getColorClass(usage.percentage),
          )}
        >
          {usage.percentage.toFixed(1)}%
        </span>
        <span className="text-muted-foreground/70">
          {formatTokens(usage.tokens)} / {formatTokens(maxTokens)}
        </span>
      </div>

      {/* Summary indicator */}
      {isSummarizing ? (
        <div className="ml-auto flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
          <span className="text-info text-xs">Summarizing...</span>
        </div>
      ) : usage.percentage >= (watermarkTokens / maxTokens) * 100 ? (
        <div className="ml-auto">
          <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
        </div>
      ) : null}
    </div>
  );
}
