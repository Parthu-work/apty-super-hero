/**
 * BrowserMessageActions
 * Custom message actions for the browser extension.
 * Renders Retry, Copy, and Save as Skill inline with each last assistant
 * message.
 */

import { Action, Actions } from "@apty/ui/components/ai-elements/actions";
import { useChatContext } from "@apty/ui/components/chatbot";
import { useTranslation } from "@apty/ui/i18n/context";
import type { MessageActionsSlotProps } from "@apty/ui/types";
import { CopyIcon, PuzzleIcon, RefreshCcwIcon } from "lucide-react";
import { useCallback } from "react";

export function BrowserMessageActions({
  message,
  onRegenerate,
  onCopy,
}: MessageActionsSlotProps) {
  const { sendMessage } = useChatContext();
  const { t } = useTranslation();

  const textContent = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");

  const handleSaveAsSkill = useCallback(() => {
    sendMessage("use skill-creator skill to save the conversation");
  }, [sendMessage]);

  return (
    <Actions className="mt-2">
      {onCopy && textContent && (
        <Action onClick={() => onCopy(textContent)} label={t("chat.copy")}>
          <CopyIcon className="size-3" />
        </Action>
      )}
      <Action onClick={handleSaveAsSkill} label={t("chat.saveAsSkill")}>
        <PuzzleIcon className="size-3" />
      </Action>
      {onRegenerate && (
        <Action onClick={onRegenerate} label={t("chat.retry")}>
          <RefreshCcwIcon className="size-3" />
        </Action>
      )}
    </Actions>
  );
}
