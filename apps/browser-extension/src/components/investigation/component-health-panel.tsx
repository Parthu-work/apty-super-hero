/**
 * APTY COMPONENTS panel — shows real, evidence-derived health for exactly
 * the two Apty product components (the Client/Widget/Player runtime and
 * Studio), never a fabricated status. Each group is expandable to reveal
 * which underlying probe (Client global, Widget global, Service Worker
 * channel) actually produced the result.
 */

import { StatusBadge } from "@apty/ui/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@apty/ui/components/ui/collapsible";
import { useTranslation } from "@apty/ui/i18n/context";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentHealth, ComponentHealthState } from "./component-health";
import { badgeTone, describeComponentHealth } from "./status-meta";

function HealthBadge({ state }: { state: ComponentHealthState }) {
  const { t } = useTranslation();
  const meta = describeComponentHealth(state, t);
  return (
    <StatusBadge tone={badgeTone(meta.tone)} indicator="icon" icon={meta.Icon}>
      {meta.label}
    </StatusBadge>
  );
}

export function ComponentHealthPanel({
  components,
}: {
  components: ComponentHealth[];
}) {
  const { t } = useTranslation();
  return (
    <ul
      className="divide-y divide-border overflow-hidden rounded-lg border border-border"
      aria-label={t("investigation.componentHealth")}
    >
      {components.map((component) => (
        <li key={component.kind}>
          <Collapsible>
            <CollapsibleTrigger className="group flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {component.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {component.detail}
                </span>
              </span>
              <HealthBadge state={component.state} />
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="space-y-2 border-t border-border px-3 py-2">
                {component.subComponents.map((sub) => (
                  <li
                    key={sub.key}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                  >
                    <span className="font-medium text-foreground">
                      {sub.label}
                    </span>
                    <HealthBadge state={sub.state} />
                    <span className="min-w-0 basis-full text-muted-foreground">
                      {sub.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </li>
      ))}
    </ul>
  );
}
