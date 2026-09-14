/**
 * BrowserChatInputArea
 * Renders the default text input area.
 *
 * Apty Agent is BYOK-only — there is no Apty-hosted proxy backend (see
 * DECISIONS.md's "BYOK only, no proxy fallback"). showServerModels={false}
 * stops the shared component from fetching a remote model list (an
 * undisclosed request to a third-party host with no legitimate purpose
 * here) and from ever showing non-functional server-side model entries in
 * the model selector.
 */

import {
  DefaultInputArea,
  type ExtendedInputAreaProps,
} from "@aipexstudio/aipex-react/components/chatbot/components";
import type { InputAreaProps } from "@aipexstudio/aipex-react/types";

export function BrowserChatInputArea(props: InputAreaProps) {
  return (
    <DefaultInputArea
      {...(props as ExtendedInputAreaProps)}
      showServerModels={false}
    />
  );
}
