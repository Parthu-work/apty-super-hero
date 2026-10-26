import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";

import { cn } from "../../lib/utils";

const Tabs = TabsPrimitive.Root;

type TabsVariant = "pill" | "underline";

const LIST: Record<TabsVariant, string> = {
  pill: "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
  underline:
    "flex h-11 items-stretch gap-1 overflow-x-auto border-b border-border text-muted-foreground",
};

const TRIGGER: Record<TabsVariant, string> = {
  pill: "rounded-sm px-3 py-1.5 ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
  underline:
    "-mb-px gap-2 border-b-2 border-transparent px-3 outline-none transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring data-[state=active]:border-foreground data-[state=active]:text-foreground motion-reduce:transition-none",
};

/** `underline`: 44 px tabs with a line under the chosen one, which scroll sideways when they don't fit. */
const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    variant?: TabsVariant;
  }
>(({ className, variant = "pill", ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-variant={variant}
    className={cn(LIST[variant], className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    variant?: TabsVariant;
  }
>(({ className, variant = "pill", ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex shrink-0 items-center justify-center whitespace-nowrap text-sm font-medium disabled:pointer-events-none disabled:opacity-50",
      TRIGGER[variant],
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
