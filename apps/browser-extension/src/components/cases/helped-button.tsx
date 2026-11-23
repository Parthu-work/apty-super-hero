/**
 * "Helpful" (K27, E7: "This helped") on a KB card: records the card and layer
 * shown as a feedback row on this device, beside Wrong card. The question
 * is not kept.
 */
import { recordHelped } from "@apty/browser-runtime/case/feedback-store";
import { ChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { useContext, useState } from "react";
import { caseStore } from "../../services/cases";
import { cardMarkContext } from "./card-mark-context";

export function HelpedButton({
  pageId,
  layer,
  aptyVersion,
}: {
  pageId: string;
  layer?: number;
  aptyVersion?: string;
}) {
  const { t } = useTranslation();
  const sessionId = useContext(ChatContext)?.sessionId ?? null;
  const [saved, setSaved] = useState(false);

  if (saved) {
    return (
      <span className="text-xs text-muted-foreground" role="status">
        {t("feedback.helpedRecorded")}
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={t("feedback.helpedFor", { pageId })}
      onClick={async () => {
        const { record, pack } = await cardMarkContext(sessionId, aptyVersion);
        await recordHelped(caseStore(), {
          ...(record ? { record } : {}),
          shownCardId: pageId,
          ...(layer ? { shownLayer: layer } : {}),
          ...(aptyVersion ? { aptyVersion } : {}),
          ...(pack ? { pack } : {}),
        });
        setSaved(true);
      }}
    >
      {t("feedback.helped")}
    </Button>
  );
}
