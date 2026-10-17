import type { RedactionModeSetting } from "@apty/agent-core";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { ShieldOffIcon } from "lucide-react";
import { openOptions } from "../lib/open-options";

/** Shown for as long as Settings → Data handling → Redaction is Off. */
export function RedactionOffBanner({
  mode,
}: {
  mode: RedactionModeSetting | undefined;
}) {
  const { t } = useTranslation();
  if (mode !== "off") return null;
  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-2 rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-xs"
    >
      <ShieldOffIcon className="size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">
        <strong>{t("redactionBanner.title")}</strong>{" "}
        {t("redactionBanner.detail")}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void openOptions({ section: "data-handling" })}
      >
        {t("redactionBanner.change")}
      </Button>
    </div>
  );
}
