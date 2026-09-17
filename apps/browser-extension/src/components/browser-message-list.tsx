/**
 * BrowserMessageList
 * Wraps the default MessageList and hides it when inputMode is "voice",
 * matching the upstream behaviour where messages are hidden in voice mode.
 */

import { DefaultMessageList } from "@apty/ui/components/chatbot/components";
import type { MessageListProps } from "@apty/ui/types";
import { useInputMode } from "../state/input-mode-context";

export function BrowserMessageList(
  props: MessageListProps & { onSuggestionClick?: (text: string) => void },
) {
  const { inputMode } = useInputMode();

  // In voice mode, hide the message list (matching full-screen voice behaviour)
  if (inputMode === "voice") {
    return null;
  }

  return <DefaultMessageList {...props} />;
}
