/**
 * "Which Apty version does acc.example.com run? 4.x 5.x Not sure" (KB-RAG
 * K29, D3): one line above an answer with cards of both versions, while
 * the site's version is not known. Answered once per site on the device
 * (Not sure included); the header's version chip changes it later.
 */
import type { KbTabVersion } from "@apty/browser-runtime/kb/kb-index";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { useId } from "react";
import { chooseKbVersion } from "./kb-version-chip";

const CHOICES: KbTabVersion[] = ["4.x", "5.x", "unknown"];

export function KbVersionQuestion({ host }: { host: string }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted px-2 py-1.5"
      data-testid="kb-version-question"
    >
      <p id={id} className="text-sm text-foreground">
        {t("kbVersion.question", { host })}
      </p>
      <div className="flex items-center gap-1">
        {CHOICES.map((choice) => (
          <Button
            key={choice}
            type="button"
            size="sm"
            variant={choice === "unknown" ? "ghost" : "secondary"}
            className="h-7 px-2 text-xs"
            onClick={() => chooseKbVersion(host, choice)}
          >
            {choice === "unknown" ? t("kbVersion.notSure") : choice}
          </Button>
        ))}
      </div>
    </div>
  );
}
