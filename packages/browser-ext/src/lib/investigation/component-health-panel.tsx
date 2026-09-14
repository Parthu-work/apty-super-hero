/**
 * APTY COMPONENTS panel (product spec section 12) — shows real,
 * evidence-derived health for Client/Widget/Studio/Service Worker. Never
 * shows a status the backend didn't actually report.
 */
import { cn } from "@aipexstudio/aipex-react/lib/utils";
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
          <li
            key={component.kind}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40"
          >
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
          </li>
        );
      })}
    </ul>
  );
}
