/**
 * Investigation-first empty state (product spec section 22). Apty's start
 * screen for the debugging agent — every prompt here is a real diagnostic
 * entry point into a live Apty Widget/Client/Studio/Service Worker issue,
 * not an open-ended "how can I help you today" AI-assistant greeting.
 */
import {
  Suggestion,
  Suggestions,
} from "@apty/ui/components/ai-elements/suggestion";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import type { WelcomeScreenProps } from "@apty/ui/types";
import {
  ChevronRightIcon,
  CrosshairIcon,
  PuzzleIcon,
  SearchCodeIcon,
  WifiOffIcon,
  WorkflowIcon,
} from "lucide-react";
import type { ReactNode } from "react";

type PromptTone = "danger" | "active" | "warning" | "success";

const TONE_ICON_CLASSES: Record<PromptTone, string> = {
  danger: "bg-destructive/10 text-destructive",
  active: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
};

const DEBUG_PROMPTS: Array<{
  category: TranslationKey;
  text: TranslationKey;
  icon: typeof PuzzleIcon;
  tone: PromptTone;
}> = [
  {
    category: "investigation.welcome.widget",
    text: "investigation.welcome.widgetPrompt",
    icon: PuzzleIcon,
    tone: "danger",
  },
  {
    category: "investigation.welcome.studio",
    text: "investigation.welcome.studioPrompt",
    icon: CrosshairIcon,
    tone: "active",
  },
  {
    category: "investigation.welcome.workflow",
    text: "investigation.welcome.workflowPrompt",
    icon: WorkflowIcon,
    tone: "warning",
  },
  {
    category: "investigation.welcome.selectors",
    text: "investigation.welcome.selectorsPrompt",
    icon: SearchCodeIcon,
    tone: "success",
  },
  {
    category: "investigation.welcome.network",
    text: "investigation.welcome.networkPrompt",
    icon: WifiOffIcon,
    tone: "danger",
  },
];

export function DebuggingWelcomeScreen({
  onSuggestionClick,
  className,
  readiness,
  ...props
}: WelcomeScreenProps & { readiness?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex min-h-full flex-col items-center justify-center-safe p-4",
        className,
      )}
      {...props}
    >
      <div className="mb-3 text-center">
        <h3 className="mb-1.5 text-lg font-semibold tracking-tight text-foreground">
          {t("investigation.welcome.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("investigation.welcome.subtitle")}
        </p>
      </div>

      {readiness && (
        <div className="mb-3 flex w-full justify-center">{readiness}</div>
      )}

      <div className="w-full max-w-2xl">
        <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("investigation.welcome.start")}
        </p>
        <Suggestions className="grid w-full gap-2 sm:grid-cols-2">
          {DEBUG_PROMPTS.map(({ category, text, icon: Icon, tone }) => (
            <Suggestion
              key={text}
              suggestion={t(text)}
              onClick={onSuggestionClick}
              variant="outline"
              size="lg"
              className={cn(
                "h-auto w-full items-center justify-start gap-2.5 rounded-lg border-border px-2.5 py-2 text-left transition-colors",
                "hover:border-foreground/20 hover:bg-accent",
              )}
            >
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md",
                  TONE_ICON_CLASSES[tone],
                )}
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(category)}
                </div>
                <div className="whitespace-normal break-words text-xs font-medium text-foreground">
                  {t(text)}
                </div>
              </div>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
            </Suggestion>
          ))}
        </Suggestions>
      </div>
    </div>
  );
}
