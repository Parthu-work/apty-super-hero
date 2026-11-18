/**
 * Ask, do not guess, on a broad symptom (KB-RAG K27, E3): the choices of the
 * "start here" card that covers the question, at most four. Choosing one
 * shows that card, its layers read from the pack loaded in Options.
 */
import type { KbCard, KbChunk, KbLayer } from "@apty/agent-core";
import { kbCardUrl } from "@apty/agent-core";
import { sharedKbIndexSource } from "@apty/browser-runtime/kb/kb-index";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { KbLayerSwitcher } from "./kb-layer-switcher";

const PAGE = /^kb:\/\/(\d+)/;

function ChosenCard({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const [found, setFound] = useState<
    { card: KbCard; first: KbChunk } | null | undefined
  >();
  useEffect(() => {
    let live = true;
    sharedKbIndexSource()
      .current()
      .then((index) => {
        const card = index?.card(pageId);
        const first = index?.cardChunks(pageId)[0];
        if (live) setFound(card && first ? { card, first } : null);
      })
      .catch(() => live && setFound(null));
    return () => {
      live = false;
    };
  }, [pageId]);
  if (found === undefined) return null;
  if (found === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("kbMatches.choiceMissing")}
      </p>
    );
  }
  const { card, first } = found;
  return (
    <div
      className="space-y-1 rounded-md border border-border p-2.5"
      data-testid="kb-chosen-card"
    >
      <a
        href={card.url || kbCardUrl(card.pageId)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {card.title}
        <ExternalLinkIcon aria-hidden="true" className="size-3" />
      </a>
      <KbLayerSwitcher
        pageId={card.pageId}
        layer={first.layer as KbLayer}
        text={first.text}
        notVerified={first.notVerified}
      />
    </div>
  );
}

export function KbChoices({
  options,
}: {
  options: ReadonlyArray<{ cite: string; title: string }>;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<string | undefined>();
  return (
    <div className="space-y-2" data-testid="kb-choices">
      <p className="text-sm font-medium text-foreground">
        {t("kbMatches.whichOne")}
      </p>
      <div
        role="group"
        aria-label={t("kbMatches.whichOne")}
        className="flex flex-col gap-1"
      >
        {options.map((option) => {
          const pageId = PAGE.exec(option.cite)?.[1] ?? "";
          return (
            <Button
              key={option.cite}
              type="button"
              size="sm"
              variant={chosen === pageId ? "secondary" : "outline"}
              aria-pressed={chosen === pageId}
              className="h-auto justify-start whitespace-normal py-1.5 text-left"
              onClick={() => setChosen(pageId)}
            >
              {option.title}
            </Button>
          );
        })}
      </div>
      {chosen && <ChosenCard key={chosen} pageId={chosen} />}
    </div>
  );
}
