/**
 * BrowserChatInputArea
 * Renders the default text input area.
 */

import {
  DefaultInputArea,
  type ExtendedInputAreaProps,
} from "@aipexstudio/aipex-react/components/chatbot/components";
import type { InputAreaProps } from "@aipexstudio/aipex-react/types";

export function BrowserChatInputArea(props: InputAreaProps) {
  return <DefaultInputArea {...(props as ExtendedInputAreaProps)} />;
}
