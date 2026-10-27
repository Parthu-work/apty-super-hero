/**
 * Home: the investigation-first empty state. Every suggestion is a real
 * diagnostic entry point into a live Apty Widget/Client/Studio/Service
 * Worker issue, not an open-ended "how can I help you today" greeting.
 */
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import type { WelcomeScreenProps } from "@apty/ui/types";
import { ActivityIcon, SlidersHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { INVESTIGATION_PROMPTS } from "../shell/investigation-prompts";
import { openDomConfigPage } from "./dom-config/dom-config-store";

const HOME_COUNT = 3;

function SuggestionRow({
  icon: Icon,
  category,
  question,
  onClick,
}: {
  icon: typeof ActivityIcon;
  category: string;
  question: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-15 w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring motion-reduce:transition-none"
      >
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground"
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">
            {category}
          </span>
          <span className="block break-words text-sm font-medium text-foreground">
            {question}
          </span>
        </span>
      </button>
    </li>
  );
}

export function DebuggingWelcomeScreen({
  onSuggestionClick,
  className,
  ...props
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const prompts = showAll
    ? INVESTIGATION_PROMPTS
    : INVESTIGATION_PROMPTS.slice(0, HOME_COUNT);

  return (
    <div
      className={cn(
        "flex min-h-full flex-col justify-between gap-6 p-4",
        className,
      )}
      {...props}
    >
      <div>
        <span
          aria-hidden="true"
          className="mb-4 flex size-12 items-center justify-center rounded-lg border border-border bg-card text-foreground"
        >
          <ActivityIcon className="size-5" />
        </span>
        <h2 className="text-display font-semibold text-foreground">
          {t("shell.home.heading")}
        </h2>
        <p className="mt-1 max-w-80 text-sm text-muted-foreground">
          {t("investigation.welcome.subtitle")}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between pl-2">
          <h3
            id="home-suggestions"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("investigation.welcome.start")}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showAll}
            aria-controls="home-suggestion-list"
            onClick={() => setShowAll((all) => !all)}
          >
            {t(showAll ? "shell.home.showFewer" : "shell.home.seeAll")}
          </Button>
        </div>
        <ul
          id="home-suggestion-list"
          aria-labelledby="home-suggestions"
          className="mt-1 space-y-0.5"
        >
          {prompts.map((prompt) => (
            <SuggestionRow
              key={prompt.id}
              icon={prompt.icon}
              category={t(prompt.category)}
              question={t(prompt.text)}
              onClick={() => onSuggestionClick(t(prompt.text))}
            />
          ))}
          {showAll && (
            <SuggestionRow
              icon={SlidersHorizontalIcon}
              category={t("domConfig.welcome.category")}
              question={t("domConfig.welcome.tile")}
              onClick={() => openDomConfigPage()}
            />
          )}
        </ul>
      </div>
    </div>
  );
}
