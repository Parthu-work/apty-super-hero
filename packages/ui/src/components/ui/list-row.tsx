import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils";

type ListRowProps = {
  icon?: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  /** A status badge or a value, shown on the right. */
  trailing?: React.ReactNode;
  chevron?: boolean;
  highlighted?: boolean;
  className?: string;
};

function RowContent({
  icon,
  label,
  description,
  trailing,
  chevron,
}: Omit<ListRowProps, "className" | "highlighted">) {
  return (
    <>
      {icon ? (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-foreground">
          {label}
        </span>
        {description ? (
          <span className="block truncate text-small text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
      {chevron ? (
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : null}
    </>
  );
}

const ROW =
  "flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 transition-colors motion-reduce:transition-none";

/** A 48 px row that opens or selects something. */
function ListRow({
  icon,
  label,
  description,
  trailing,
  chevron,
  highlighted,
  className,
  ...button
}: ListRowProps &
  Omit<React.ComponentProps<"button">, "children" | keyof ListRowProps>) {
  return (
    <button
      type="button"
      data-slot="list-row"
      data-highlighted={highlighted || undefined}
      className={cn(
        ROW,
        "cursor-pointer outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring data-[highlighted]:bg-accent aria-[current=page]:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...button}
    >
      <RowContent
        icon={icon}
        label={label}
        description={description}
        trailing={trailing}
        chevron={chevron}
      />
    </button>
  );
}

/** The same layout for a row that only shows something. */
function ListRowStatic({
  icon,
  label,
  description,
  trailing,
  className,
  ...div
}: Omit<ListRowProps, "chevron" | "highlighted"> &
  Omit<React.ComponentProps<"div">, "children" | keyof ListRowProps>) {
  return (
    <div data-slot="list-row" className={cn(ROW, className)} {...div}>
      <RowContent
        icon={icon}
        label={label}
        description={description}
        trailing={trailing}
      />
    </div>
  );
}

export { ListRow, ListRowStatic };
