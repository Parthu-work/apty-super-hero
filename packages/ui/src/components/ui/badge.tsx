import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import {
  CheckIcon,
  CircleAlertIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive transition-colors motion-reduce:transition-none overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        neutral:
          "h-6 rounded-full border-transparent bg-muted px-2.5 text-muted-foreground",
        info: "h-6 rounded-full border-transparent bg-info-muted px-2.5 text-info",
        success:
          "h-6 rounded-full border-transparent bg-success-muted px-2.5 text-success",
        warning:
          "h-6 rounded-full border-warning-border bg-warning-muted px-2.5 text-warning",
        danger:
          "h-6 rounded-full border-transparent bg-destructive-muted px-2.5 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_ICON: Record<
  StatusTone,
  React.ComponentType<{ className?: string }>
> = {
  neutral: InfoIcon,
  info: InfoIcon,
  success: CheckIcon,
  warning: TriangleAlertIcon,
  danger: CircleAlertIcon,
};

/**
 * A status never shown by colour alone: a dot, a spinner or an icon, then
 * the word. The indicator is decorative; the text carries the meaning.
 */
function StatusBadge({
  tone,
  indicator = tone === "neutral" ? "dot" : "icon",
  icon,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  tone: StatusTone;
  indicator?: "dot" | "spinner" | "icon";
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <Badge
      variant={tone}
      data-tone={tone}
      className={cn("gap-1.5", className)}
      {...props}
    >
      {indicator === "dot" ? (
        <span
          aria-hidden="true"
          data-indicator="dot"
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      ) : indicator === "spinner" ? (
        <Loader2Icon
          aria-hidden="true"
          data-indicator="spinner"
          className="animate-spin motion-reduce:animate-none"
        />
      ) : (
        <Icon aria-hidden="true" data-indicator="icon" />
      )}
      <span>{children}</span>
    </Badge>
  );
}

export { Badge, StatusBadge, type StatusTone };
