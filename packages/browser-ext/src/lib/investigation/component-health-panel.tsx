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
import { toneTextClass } from "./tone-classes";

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
          <li key={component.kind} className="rounded-md border">
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-start gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/40">
                <span
                  className={cn(
                    "mt-0.5 w-4 shrink-0 text-center font-semibold",
                    toneTextClass(meta.tone),
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
                        "text-xs font-medium",
                        toneTextClass(meta.tone),
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
                            "font-semibold",
                            toneTextClass(subMeta.tone),
                          )}
                          aria-hidden="true"
                        >
                          {subMeta.symbol}
                        </span>
                        {sub.label}
                      </span>
                      <span className="text-muted-foreground">
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
