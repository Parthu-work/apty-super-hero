import type * as React from "react";

import { cn } from "../../lib/utils";

/** A centred placeholder: an icon, a title, a sentence and an optional action. */
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title" | "children"> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-2 px-4 py-8 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-1 flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground [&_svg]:size-5"
        >
          {icon}
        </span>
      ) : null}
      <h2 className="text-title font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="max-w-80 text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
