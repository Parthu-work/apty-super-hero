import type * as React from "react";

import { cn } from "../../lib/utils";

/**
 * A settings row: the label and its helper on the left, the control on the
 * right from 640 px up, and the control under them below that.
 */
function SettingRow({
  label,
  helper,
  htmlFor,
  control,
  className,
}: {
  label: React.ReactNode;
  helper?: React.ReactNode;
  /** The control's id, when the label names it. */
  htmlFor?: string;
  control: React.ReactNode;
  className?: string;
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div
      data-slot="setting-row"
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <Label
          htmlFor={htmlFor}
          className="block text-sm font-medium text-foreground"
        >
          {label}
        </Label>
        {helper ? (
          <p className="text-small text-muted-foreground">{helper}</p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export { SettingRow };
