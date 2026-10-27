import * as ProgressPrimitive from "@radix-ui/react-progress";
import type * as React from "react";

import { cn } from "../../lib/utils";

type ProgressTone = "info" | "success" | "warning" | "danger";

const FILL: Record<ProgressTone, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

/**
 * A determinate bar when `value` is a number (it then carries
 * aria-valuenow), an indeterminate one when it is null. The indeterminate
 * sweep stops under prefers-reduced-motion.
 */
function ProgressBar({
  value,
  max = 100,
  tone = "info",
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof ProgressPrimitive.Root>,
  "value" | "max"
> & {
  value: number | null;
  max?: number;
  tone?: ProgressTone;
}) {
  const clamped = value === null ? null : Math.min(Math.max(value, 0), max);
  return (
    <ProgressPrimitive.Root
      data-slot="progress-bar"
      value={clamped}
      max={max}
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full rounded-full",
          FILL[tone],
          clamped === null
            ? "w-2/5 animate-progress-indeterminate motion-reduce:animate-none"
            : "transition-[width] duration-200 motion-reduce:transition-none",
        )}
        style={
          clamped === null ? undefined : { width: `${(clamped / max) * 100}%` }
        }
      />
    </ProgressPrimitive.Root>
  );
}

export { ProgressBar, type ProgressTone };
