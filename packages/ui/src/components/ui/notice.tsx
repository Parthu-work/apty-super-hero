import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils";

type NoticeTone = "warning" | "info" | "error" | "success";

const TONES: Record<
  NoticeTone,
  {
    box: string;
    icon: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  warning: {
    box: "border-warning-border bg-warning-muted",
    icon: "text-warning",
    Icon: TriangleAlertIcon,
  },
  info: { box: "border-border bg-card", icon: "text-info", Icon: InfoIcon },
  error: {
    box: "border-destructive/40 bg-destructive-muted",
    icon: "text-destructive",
    Icon: CircleAlertIcon,
  },
  success: {
    box: "border-success/40 bg-success-muted",
    icon: "text-success",
    Icon: CircleCheckIcon,
  },
};

/**
 * An inline message with an icon and text. Errors are announced at once
 * (role="alert"); the other tones are polite status updates.
 */
function Notice({
  tone,
  title,
  action,
  icon: CustomIcon,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  tone: NoticeTone;
  title?: React.ReactNode;
  action?: React.ReactNode;
  /** In place of the tone's own icon, such as a shield for an approval. */
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const { box, icon, Icon: ToneIcon } = TONES[tone];
  const Icon = CustomIcon ?? ToneIcon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-slot="notice"
      data-tone={tone}
      className={cn(
        "flex gap-3 rounded-lg border p-3 text-sm text-foreground",
        box,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", icon)} />
      <div className="min-w-0 flex-1 space-y-1 break-words">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}

export { Notice, type NoticeTone };
