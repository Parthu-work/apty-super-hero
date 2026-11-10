/**
 * "From the KB card" under a check pack's cause (KB-RAG K5): the layer of
 * the cause's card that the rule names, with the card's "Verified on" line
 * and a badge when it says NOT VERIFIED, read from the pack imported in
 * Options. Nothing is shown without a pack, or when the pack does not hold
 * the card; the card link stays either way. The text is rendered as text.
 */
import {
  type KbAptyVersion,
  type KbCard,
  type KbChunk,
  type KbLayer,
  kbCardUrl,
} from "@apty/agent-core";
import { sharedKbIndexSource } from "@apty/browser-runtime/kb/kb-index";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@apty/ui/components/ui/collapsible";
import { useTranslation } from "@apty/ui/i18n/context";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { KbShownHereOnly } from "./kb-egress-note";

interface Excerpt {
  card: KbCard;
  chunk: KbChunk;
}

function useKbExcerpt(pageId: string, layer: KbLayer): Excerpt | undefined {
  const [excerpt, setExcerpt] = useState<Excerpt | undefined>();
  useEffect(() => {
    let live = true;
    sharedKbIndexSource()
      .current()
      .then((index) => {
        const card = index?.card(pageId);
        const chunk = index
          ?.cardChunks(pageId)
          .find((candidate) => candidate.layer === layer);
        if (live) setExcerpt(card && chunk ? { card, chunk } : undefined);
      })
      .catch(() => live && setExcerpt(undefined));
    return () => {
      live = false;
    };
  }, [pageId, layer]);
  return excerpt;
}

/**
 * A card's link: its own page when a loaded pack holds it (each version's
 * cards live in their own space), else its version's space.
 */
export function useKbCardUrl(
  pageId: string,
  aptyVersion?: KbAptyVersion,
): string {
  const fallback = kbCardUrl(pageId, { aptyVersion });
  const [url, setUrl] = useState(fallback);
  useEffect(() => {
    let live = true;
    setUrl(fallback);
    sharedKbIndexSource()
      .current()
      .then((index) => {
        const own = index?.card(pageId)?.url;
        if (live && own) setUrl(own);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pageId, fallback]);
  return url;
}

export function KbCardExcerpt({
  pageId,
  layer,
}: {
  pageId: string;
  layer: KbLayer;
}) {
  const { t } = useTranslation();
  const excerpt = useKbExcerpt(pageId, layer);
  const [open, setOpen] = useState(false);
  if (!excerpt) return null;
  const { card, chunk } = excerpt;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
        />
        {t("checkPack.kbCard.from")}
        {chunk.notVerified && (
          <StatusBadge tone="warning">
            {t("checkPack.kbCard.notVerified")}
          </StatusBadge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 space-y-1 rounded-md bg-muted p-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("checkPack.kbCard.layer", { layer, title: card.title })}
        </p>
        <p className="whitespace-pre-line text-sm text-foreground">
          {chunk.text}
        </p>
        <p className="text-xs text-muted-foreground">
          {card.verifiedOn ?? t("checkPack.kbCard.noVerifiedLine")}
        </p>
        <KbShownHereOnly />
      </CollapsibleContent>
    </Collapsible>
  );
}
