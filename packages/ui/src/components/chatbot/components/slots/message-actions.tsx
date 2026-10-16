import {
  CheckIcon,
  CopyIcon,
  RefreshCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "../../../../i18n/context";
import type { MessageActionsSlotProps } from "../../../../types";
import { Action, Actions } from "../../../ai-elements/actions";

/**
 * Default message actions slot component
 */
export function DefaultMessageActions({
  message,
  onRegenerate,
  onCopy,
}: MessageActionsSlotProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  // Find text content for copy
  const textContent = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");

  return (
    <Actions className="mt-2">
      {onRegenerate && (
        <Action onClick={onRegenerate} label={t("chat.retry")}>
          <RefreshCcwIcon className="size-3" />
        </Action>
      )}
      {onCopy && textContent && (
        <Action
          onClick={async () => {
            const result = await onCopy(textContent);
            if (result === undefined || result) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          }}
          label={t(copied ? "common.copied" : "common.copy")}
        >
          {copied ? (
            <CheckIcon className="size-3" />
          ) : (
            <CopyIcon className="size-3" />
          )}
        </Action>
      )}
    </Actions>
  );
}

/**
 * Extended message actions with feedback buttons
 */
export function MessageActionsWithFeedback({
  message,
  onRegenerate,
  onCopy,
  onFeedback,
}: MessageActionsSlotProps & {
  onFeedback?: (messageId: string, type: "up" | "down") => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const textContent = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");

  return (
    <Actions className="mt-2">
      {onRegenerate && (
        <Action onClick={onRegenerate} label={t("chat.retry")}>
          <RefreshCcwIcon className="size-3" />
        </Action>
      )}
      {onCopy && textContent && (
        <Action
          onClick={async () => {
            const result = await onCopy(textContent);
            if (result === undefined || result) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          }}
          label={t(copied ? "common.copied" : "common.copy")}
        >
          {copied ? (
            <CheckIcon className="size-3" />
          ) : (
            <CopyIcon className="size-3" />
          )}
        </Action>
      )}
      {onFeedback && (
        <>
          <Action
            onClick={() => onFeedback(message.id, "up")}
            label={t("chat.goodResponse")}
          >
            <ThumbsUpIcon className="size-3" />
          </Action>
          <Action
            onClick={() => onFeedback(message.id, "down")}
            label={t("chat.badResponse")}
          >
            <ThumbsDownIcon className="size-3" />
          </Action>
        </>
      )}
    </Actions>
  );
}
