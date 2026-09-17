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
 *
 * The placeholder copy is overridden here (rather than relying on the
 * shared component's generic "Search or Ask anything" default) so the
 * composer reads as a debugging tool, not a general-purpose AI search box.
 */

import {
  DefaultInputArea,
  type ExtendedInputAreaProps,
} from "@apty/ui/components/chatbot/components";
import type { InputAreaProps } from "@apty/ui/types";

const DEBUGGING_PLACEHOLDER_TEXTS = [
  "Describe the issue you're investigating…",
  "Why isn't my Apty Widget showing?",
  "Why can't Studio select this element?",
  "What caused this network failure?",
];

export function BrowserChatInputArea(props: InputAreaProps) {
  return (
    <DefaultInputArea
      placeholderTexts={DEBUGGING_PLACEHOLDER_TEXTS}
      {...(props as ExtendedInputAreaProps)}
      showServerModels={false}
      placeholder={props.placeholder ?? DEBUGGING_PLACEHOLDER_TEXTS[0]}
    />
  );
}
