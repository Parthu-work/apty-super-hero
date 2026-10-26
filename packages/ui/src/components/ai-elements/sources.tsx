"use client";

import { BookIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "../../i18n/context";
import { cn } from "../../lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

type SourcesProps = ComponentProps<"div">;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible
    className={cn("not-prose text-sm text-info", className)}
    {...props}
  />
);

type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps) => {
  const { t } = useTranslation();
  return (
    <CollapsibleTrigger
      className={cn(
        "group flex items-center gap-2 rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <span className="font-medium">
            {t("chat.usedSources", { count })}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </>
      )}
    </CollapsibleTrigger>
  );
};

type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
  className,
  ...props
}: SourcesContentProps) => (
  <CollapsibleContent
    className={cn("mt-2 flex w-fit flex-col gap-2", className)}
    {...props}
  />
);

type SourceProps = ComponentProps<"a">;

export const Source = ({ href, title, children, ...props }: SourceProps) => (
  <a
    className="flex items-center gap-2 rounded-sm text-info underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    href={href}
    rel="noreferrer"
    target="_blank"
    {...props}
  >
    {children ?? (
      <>
        <BookIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="block break-all">{title}</span>
      </>
    )}
  </a>
);
