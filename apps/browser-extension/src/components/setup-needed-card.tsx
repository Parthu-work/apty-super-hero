/**
 * Send pressed with no AI provider configured: nothing was sent or saved,
 * so this in-chat warning carries the unsent draft, a way to set up the
 * provider and Dismiss. It is never added to the conversation.
 */

import { Button } from "@apty/ui/components/ui/button";
import { Notice } from "@apty/ui/components/ui/notice";
import { useTranslation } from "@apty/ui/i18n/context";

export interface SetupNeededCardProps {
  /** The message the user typed before the send was blocked. */
  draftText: string;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

export function SetupNeededCard({
  draftText,
  onOpenSettings,
  onDismiss,
}: SetupNeededCardProps) {
  const { t } = useTranslation();
  const trimmed = draftText.trim();
  const preview = trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;

  return (
    <Notice
      tone="warning"
      className="mb-4"
      title={t("setupNeeded.title")}
      action={
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onOpenSettings}>
            {t("setupNeeded.setUp")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            {t("common.dismiss")}
          </Button>
        </div>
      }
    >
      <p>{t("setupNeeded.description")}</p>
      {preview && (
        <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-small text-muted-foreground">
          {t("setupNeeded.notSent", { preview })}
        </p>
      )}
    </Notice>
  );
}
