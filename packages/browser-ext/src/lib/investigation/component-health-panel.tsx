/**
 * APTY COMPONENTS panel — shows real, evidence-derived health for exactly
 * the two Apty product components (the Client/Widget/Player runtime and
 * Studio), never a fabricated status. Each group is expandable to reveal
 * which underlying probe (Client global, Widget global, Service Worker
 * channel) actually produced the result.
 */

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@aipexstudio/aipex-react/components/ui/collapsible";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentHealth } from "./component-health";
import { describeComponentHealth } from "./status-meta";
import { toneBadgeClass } from "./tone-classes";

export function ComponentHealthPanel({
  components,
}: {
  components: ComponentHealth[];
}) {
  return (
    <ul className="space-y-1.5" aria-label="Apty component health">
      {components.map((component) => {
        const meta = describeComponentHealth(component.state);
        return (
          <li
            key={component.kind}
            className="overflow-hidden rounded-md border transition-colors duration-300"
          >
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-start gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/40">
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-colors duration-300",
                    toneBadgeClass(meta.tone),
                  )}
                  aria-hidden="true"
                >
                  {meta.symbol}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{component.label}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors duration-300",
                        toneBadgeClass(meta.tone),
                      )}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {component.detail}
                  </p>
                </div>
                <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 border-t px-2 py-1.5 pl-8">
                {component.subComponents.map((sub) => {
                  const subMeta = describeComponentHealth(sub.state);
                  return (
                    <div
                      key={sub.key}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold",
                            toneBadgeClass(subMeta.tone),
                          )}
                          aria-hidden="true"
                        >
                          {subMeta.symbol}
                        </span>
                        {sub.label}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {sub.detail}
                      </span>
                    </div>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          </li>
        );
      })}
    </ul>
  );
}
