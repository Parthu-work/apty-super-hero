import type { TranslationKey } from "@apty/ui/i18n/types";
import {
  CrosshairIcon,
  PuzzleIcon,
  SearchCodeIcon,
  WifiOffIcon,
  WorkflowIcon,
} from "lucide-react";

interface InvestigationPrompt {
  id: "widget" | "studio" | "workflow" | "selectors" | "network";
  category: TranslationKey;
  text: TranslationKey;
  icon: typeof PuzzleIcon;
}

/** The suggested investigations; Home shows the first three. */
export const INVESTIGATION_PROMPTS: InvestigationPrompt[] = [
  {
    id: "widget",
    category: "investigation.welcome.widget",
    text: "investigation.welcome.widgetPrompt",
    icon: PuzzleIcon,
  },
  {
    id: "studio",
    category: "investigation.welcome.studio",
    text: "investigation.welcome.studioPrompt",
    icon: CrosshairIcon,
  },
  {
    id: "workflow",
    category: "investigation.welcome.workflow",
    text: "investigation.welcome.workflowPrompt",
    icon: WorkflowIcon,
  },
  {
    id: "selectors",
    category: "investigation.welcome.selectors",
    text: "investigation.welcome.selectorsPrompt",
    icon: SearchCodeIcon,
  },
  {
    id: "network",
    category: "investigation.welcome.network",
    text: "investigation.welcome.networkPrompt",
    icon: WifiOffIcon,
  },
];
