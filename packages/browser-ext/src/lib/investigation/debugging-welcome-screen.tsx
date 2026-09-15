/**
 * Investigation-first empty state (product spec section 22). Apty's start
 * screen for the debugging agent — every prompt here is a real diagnostic
 * entry point into a live Apty Widget/Client/Studio/Service Worker issue,
 * not an open-ended "how can I help you today" AI-assistant greeting.
 */
import {
  Suggestion,
  Suggestions,
} from "@aipexstudio/aipex-react/components/ai-elements/suggestion";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import type { WelcomeScreenProps } from "@aipexstudio/aipex-react/types";
import {
  ChevronRightIcon,
  CrosshairIcon,
  PuzzleIcon,
  SearchCodeIcon,
  WifiOffIcon,
  WorkflowIcon,
} from "lucide-react";

type PromptTone = "danger" | "active" | "warning" | "success";

const TONE_ICON_CLASSES: Record<PromptTone, string> = {
  danger: "bg-destructive/10 text-destructive",
  active: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
};

const DEBUG_PROMPTS: Array<{
  category: string;
  text: string;
  icon: typeof PuzzleIcon;
  tone: PromptTone;
}> = [
  {
    category: "Widget",
    text: "Why isn't my Apty Widget showing?",
    icon: PuzzleIcon,
    tone: "danger",
  },
  {
    category: "Studio",
    text: "Why can't Studio select this element?",
    icon: CrosshairIcon,
    tone: "active",
  },
  {
    category: "Workflow",
    text: "Why did this workflow stop?",
    icon: WorkflowIcon,
    tone: "warning",
  },
  {
    category: "Selectors",
    text: "Is this selector reliable?",
    icon: SearchCodeIcon,
    tone: "success",
  },
  {
    category: "Network",
    text: "What caused this network failure?",
    icon: WifiOffIcon,
    tone: "danger",
  },
];

export function DebuggingWelcomeScreen({
  onSuggestionClick,
  className,
  ...props
}: WelcomeScreenProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center p-4",
        className,
      )}
      {...props}
    >
      <div className="mb-6 text-center">
        <h3 className="mb-1.5 text-lg font-semibold tracking-tight text-foreground">
          Apty Live Debugging
        </h3>
        <p className="text-sm text-muted-foreground">
          Investigate a live Apty Widget, Client, Studio, or Service Worker
          issue with evidence from the actual page.
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Start an investigation
        </p>
        <Suggestions className="grid w-full gap-2 sm:grid-cols-2">
          {DEBUG_PROMPTS.map(({ category, text, icon: Icon, tone }) => (
            <Suggestion
              key={text}
              suggestion={text}
              onClick={onSuggestionClick}
              variant="outline"
              size="lg"
              className={cn(
                "h-auto w-full items-center justify-start gap-3 rounded-lg border-border p-3 text-left transition-colors",
                "hover:border-foreground/20 hover:bg-accent",
              )}
            >
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md",
                  TONE_ICON_CLASSES[tone],
                )}
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </div>
                <div className="whitespace-normal break-words text-xs font-medium text-foreground">
                  {text}
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
