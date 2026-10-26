/**
 * BrowserChatInputArea
 * The composer: the shared input area with the debugging placeholder, the
 * "/" list's tools and investigations, and the hint line under it.
 *
 * Apty Agent is BYOK-only — there is no Apty-hosted proxy backend (see
 * DECISIONS.md's "BYOK only, no proxy fallback"). showServerModels={false}
 * keeps non-functional hosted-model entries out of the model selector.
 */

import type { SlashCommandGroup } from "@apty/ui/components/ai-elements/slash-commands";
import { useChatContext, useConfigContext } from "@apty/ui/components/chatbot";
import {
  DefaultInputArea,
  type ExtendedInputAreaProps,
} from "@apty/ui/components/chatbot/components";
import { useTranslation } from "@apty/ui/i18n/context";
import type { InputAreaProps } from "@apty/ui/types";
import {
  ActivityIcon,
  CrosshairIcon,
  ScanSearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useMemo } from "react";
import { isProviderConfigured } from "../services/ai-provider";
import { navigationStore } from "../state/navigation-store";
import { ProviderSetupChip } from "./connections/setup-badge";
import { revealDomConfigCard } from "./investigation/dom-config/dom-config-store";
import { INVESTIGATION_PROMPTS } from "./shell/investigation-prompts";

const DEBUGGING_PLACEHOLDER_TEXTS = [
  "Describe the issue you're investigating…",
  "Why isn't my Apty Widget showing?",
  "Why can't Studio select this element?",
  "What caused this network failure?",
];

/** The "/" list: the tools, then the three Home investigations. */
function useSlashCommands(): SlashCommandGroup[] {
  const { t } = useTranslation();
  const { sendMessage } = useChatContext();
  return useMemo(
    () => [
      {
        id: "tools",
        label: t("slash.tools"),
        commands: [
          {
            id: "dom-health",
            label: t("shell.domHealth"),
            description: t("slash.domHealth"),
            icon: <ScanSearchIcon />,
            onSelect: () => navigationStore.openPage("dom-health"),
          },
          {
            id: "dom-config",
            label: t("shell.domConfig"),
            description: t("slash.domConfig"),
            icon: <SlidersHorizontalIcon />,
            onSelect: () => revealDomConfigCard(),
          },
          {
            id: "selector-checker",
            label: t("shell.selectorChecker"),
            description: t("slash.selectorChecker"),
            icon: <CrosshairIcon />,
            onSelect: () =>
              void sendMessage(t("investigation.welcome.selectorsPrompt")),
          },
          {
            id: "network-inspector",
            label: t("shell.networkInspector"),
            description: t("slash.networkInspector"),
            icon: <ActivityIcon />,
            onSelect: () =>
              void sendMessage(t("investigation.welcome.networkPrompt")),
          },
        ],
      },
      {
        id: "investigations",
        label: t("slash.investigations"),
        commands: INVESTIGATION_PROMPTS.slice(0, 3).map((prompt) => ({
          id: prompt.id,
          label: t(prompt.category),
          description: t(prompt.text),
          icon: <prompt.icon />,
          onSelect: () => void sendMessage(t(prompt.text)),
        })),
      },
    ],
    [t, sendMessage],
  );
}

export function BrowserChatInputArea(props: InputAreaProps) {
  const { t } = useTranslation();
  const slashCommands = useSlashCommands();
  const { settings } = useConfigContext();
  return (
    <div className="shrink-0">
      <DefaultInputArea
        placeholderTexts={DEBUGGING_PLACEHOLDER_TEXTS}
        {...(props as ExtendedInputAreaProps)}
        showServerModels={false}
        placeholder={props.placeholder ?? DEBUGGING_PLACEHOLDER_TEXTS[0]}
        slashCommands={slashCommands}
        modelControl={
          isProviderConfigured(settings) ? undefined : <ProviderSetupChip />
        }
        className="pb-1"
      />
      <p className="px-4 pb-2 text-center text-small text-subtle-foreground">
        {t("shell.composerHint")}
      </p>
    </div>
  );
}
