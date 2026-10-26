import { useTranslation } from "../../../i18n/context";
import {
  CHAT_ERROR_TEXT,
  type ChatErrorInfo,
  settingsCanFix,
} from "../../../lib/chat-error";
import { Button } from "../../ui/button";
import { Notice } from "../../ui/notice";

/**
 * A failed turn in the transcript: what went wrong in one sentence, the
 * provider's own message under Details, Retry, and the provider settings
 * when changing them can fix it.
 */
export function ChatErrorNotice({
  error,
  onRetry,
  onOpenSettings,
}: {
  error: ChatErrorInfo;
  /** Absent when this is not the last message: Retry regenerates the last answer only. */
  onRetry?: () => void;
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation();
  const body =
    error.kind === "rateLimit" && error.retryAfterMs
      ? t("chatErrors.rateLimitRetry", {
          seconds: Math.ceil(error.retryAfterMs / 1000),
        })
      : t(CHAT_ERROR_TEXT[error.kind]);
  const openSettings = settingsCanFix(error.kind) ? onOpenSettings : undefined;

  return (
    <Notice
      tone="error"
      title={t("chatErrors.title")}
      data-error-kind={error.kind}
      action={
        onRetry || openSettings ? (
          <div className="flex flex-wrap gap-2">
            {onRetry && (
              <Button type="button" variant="secondary" onClick={onRetry}>
                {t("chat.retry")}
              </Button>
            )}
            {openSettings && (
              <Button type="button" variant="ghost" onClick={openSettings}>
                {t("chatErrors.openSettings")}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <p>{body}</p>
      {error.message && (
        <details className="mt-2">
          <summary className="w-fit cursor-pointer rounded-sm text-small font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t("chatErrors.details")}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-small text-foreground">
            {error.message}
          </pre>
        </details>
      )}
    </Notice>
  );
}
