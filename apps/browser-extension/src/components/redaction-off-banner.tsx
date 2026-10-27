import type { RedactionModeSetting } from "@apty/agent-core";
import { Button } from "@apty/ui/components/ui/button";
import { Notice } from "@apty/ui/components/ui/notice";
import { useTranslation } from "@apty/ui/i18n/context";
import { ShieldOffIcon } from "lucide-react";
import { openOptions } from "../lib/open-options";

/** Shown for as long as Settings → Data handling → Redaction is Off; it cannot be dismissed. */
export function RedactionOffBanner({
  mode,
}: {
  mode: RedactionModeSetting | undefined;
}) {
  const { t } = useTranslation();
  if (mode !== "off") return null;
  return (
    <Notice
      tone="warning"
      icon={ShieldOffIcon}
      className="mb-2"
      title={t("redactionBanner.title")}
      action={
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void openOptions({ section: "data-handling" })}
        >
          {t("redactionBanner.change")}
        </Button>
      }
    >
      <p className="text-small">{t("redactionBanner.detail")}</p>
    </Notice>
  );
}
