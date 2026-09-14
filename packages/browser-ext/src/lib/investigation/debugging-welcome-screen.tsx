/**
 * Investigation-first empty state (product spec section 22) — replaces the
 * generic "how can I help you today" AIPex welcome screen with prompts that
 * make the product's purpose obvious: debugging a live Apty issue, not
 * open-ended browser assistance.
 */
import {
  Suggestion,
  Suggestions,
} from "@aipexstudio/aipex-react/components/ai-elements/suggestion";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import type { WelcomeScreenProps } from "@aipexstudio/aipex-react/types";
import {
  CrosshairIcon,
  NetworkIcon,
  PuzzleIcon,
  WifiOffIcon,
  WorkflowIcon,
} from "lucide-react";

const DEBUG_PROMPTS: Array<{
  text: string;
  icon: typeof PuzzleIcon;
  iconColor: string;
  bgColor: string;
}> = [
  {
    text: "Why isn't my Apty Widget showing?",
    icon: PuzzleIcon,
    iconColor: "text-blue-600",
    bgColor: "bg-blue-100 dark:bg-blue-950",
  },
  {
    text: "Why can't Studio select this element?",
    icon: CrosshairIcon,
    iconColor: "text-purple-600",
    bgColor: "bg-purple-100 dark:bg-purple-950",
  },
  {
    text: "Why did this workflow stop?",
    icon: WorkflowIcon,
    iconColor: "text-orange-600",
    bgColor: "bg-orange-100 dark:bg-orange-950",
  },
  {
    text: "Is this selector reliable?",
    icon: NetworkIcon,
    iconColor: "text-cyan-600",
    bgColor: "bg-cyan-100 dark:bg-cyan-950",
  },
  {
    text: "What caused this network failure?",
    icon: WifiOffIcon,
    iconColor: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-950",
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
        "flex h-full flex-col items-center justify-center p-4 sm:p-8",
        className,
      )}
      {...props}
    >
      <div className="mb-6 text-center sm:mb-8">
        <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
          Apty Live Debugging
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Investigate a live Apty Widget, Client, Studio, or Service Worker
          issue with evidence from the actual page — describe what's broken to
          start.
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <Suggestions className="grid w-full gap-3 sm:grid-cols-2 sm:gap-4">
          {DEBUG_PROMPTS.map(({ text, icon: Icon, iconColor, bgColor }) => (
            <Suggestion
              key={text}
              suggestion={text}
              onClick={onSuggestionClick}
              variant="outline"
              size="lg"
              className={cn(
                "h-auto w-full items-center justify-start rounded-xl border p-4 transition-all duration-200 sm:p-5",
                "bg-white/70 hover:shadow-md dark:bg-gray-800/70",
                "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600",
              )}
            >
              <div className="flex w-full items-center gap-3">
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl",
                    bgColor,
                  )}
                >
                  <Icon className={cn("size-5", iconColor)} />
                </div>
                <div className="flex-1 whitespace-normal break-words text-left text-xs text-gray-700 dark:text-gray-300">
                  {text}
                </div>
              </div>
            </Suggestion>
          ))}
        </Suggestions>
      </div>
    </div>
  );
}
