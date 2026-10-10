import type { RedactionModeSetting } from "@apty/agent-core";
import { Button } from "@apty/ui/components/ui/button";
import { ShieldOffIcon } from "lucide-react";
import { openOptions } from "../lib/open-options";

/** Shown for as long as Settings → Data handling → Redaction is Off. */
export function RedactionOffBanner({
  mode,
}: {
  mode: RedactionModeSetting | undefined;
}) {
  if (mode !== "off") return null;
  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-2 rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-xs"
    >
      <ShieldOffIcon className="size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">
        <strong>Redaction is OFF</strong> (development only). Personal data,
        page titles and paths reach your AI provider unmasked; tokens, keys and
        emails are still masked.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void openOptions({ section: "data-handling" })}
      >
        Change
      </Button>
    </div>
  );
}
