import type * as React from "react";

import { cn } from "../../lib/utils";

/**
 * A radio card. It is a native radio inside its label, so arrow keys move
 * between the cards of one group and Space selects, as in any radio group.
 * As a checkbox card, Space toggles it.
 */
function OptionCard({
  title,
  description,
  badge,
  type = "radio",
  className,
  disabled,
  ...input
}: Omit<React.ComponentProps<"input">, "type" | "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  type?: "radio" | "checkbox";
}) {
  return (
    <label
      data-slot="option-card"
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors motion-reduce:transition-none hover:bg-accent/60",
        "has-[:checked]:border-info has-[:checked]:bg-info-muted",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        disabled && "cursor-not-allowed opacity-50 hover:bg-card",
        className,
      )}
    >
      <input
        type={type}
        disabled={disabled}
        className={cn(
          "mt-0.5 size-4 shrink-0 cursor-[inherit] outline-none",
          type === "radio"
            ? "appearance-none rounded-full border border-input bg-background checked:border-[5px] checked:border-info"
            : "accent-info",
        )}
        {...input}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {badge}
        </span>
        {description ? (
          <span className="mt-0.5 block text-small text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function OptionCardGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="radiogroup"
      data-slot="option-card-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  );
}

export { OptionCard, OptionCardGroup };
