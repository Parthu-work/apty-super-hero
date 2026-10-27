/**
 * BrowserMessageActions
 * The panel's actions under an answer: Copy on every answer, and Save as
 * skill and Retry on the last one.
 */

import { Action, Actions } from "@apty/ui/components/ai-elements/actions";
import { useChatContext } from "@apty/ui/components/chatbot";
import { useCopiedFlag } from "@apty/ui/components/ui/copy-button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { MessageActionsSlotProps } from "@apty/ui/types";
import { CheckIcon, CopyIcon, PuzzleIcon, RefreshCcwIcon } from "lucide-react";
import { useCallback } from "react";

export function BrowserMessageActions({
  message,
  isLast,
  onRegenerate,
  onCopy,
}: MessageActionsSlotProps) {
  const { sendMessage } = useChatContext();
  const { t } = useTranslation();
  const [copied, flashCopied] = useCopiedFlag();

  const textContent = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");

  const handleSaveAsSkill = useCallback(() => {
    sendMessage("use skill-creator skill to save the conversation");
  }, [sendMessage]);

  return (
    <Actions>
      {onCopy && textContent && (
        <Action
          onClick={async () => {
            const result = await onCopy(textContent);
            if (result === undefined || result) flashCopied();
          }}
          tooltip={t(copied ? "common.copied" : "chat.copy")}
        >
          {copied ? (
            <CheckIcon aria-hidden="true" />
          ) : (
            <CopyIcon aria-hidden="true" />
          )}
        </Action>
      )}
      {isLast && (
        <Action onClick={handleSaveAsSkill} tooltip={t("chat.saveAsSkill")}>
          <PuzzleIcon aria-hidden="true" />
        </Action>
      )}
      {onRegenerate && (
        <Action onClick={onRegenerate} tooltip={t("chat.retry")}>
          <RefreshCcwIcon aria-hidden="true" />
        </Action>
      )}
    </Actions>
  );
}
