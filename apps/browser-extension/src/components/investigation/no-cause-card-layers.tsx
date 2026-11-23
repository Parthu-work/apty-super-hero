/**
 * Under a check with no cause in the files (KB-RAG K27, F8), or with no
 * data to read (K29, B5): the rule's KB card by title, with its layer 1 and
 * 2 text (settings, then Console and Elements) from the pack loaded in
 * Options, so the SE has the next things to look at rather than a bare link. Nothing without a pack holding the
 * card. The text is rendered as text.
 */
import type { KbCard, KbChunk } from "@apty/agent-core";
import { sharedKbIndexSource } from "@apty/browser-runtime/kb/kb-index";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { useTranslation } from "@apty/ui/i18n/context";
import { useEffect, useState } from "react";

export function NoCauseCardLayers({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const [found, setFound] = useState<
    { card: KbCard; chunks: KbChunk[] } | undefined
  >();
  useEffect(() => {
    let live = true;
    sharedKbIndexSource()
      .current()
      .then((index) => {
        const card = index?.card(pageId);
        const chunks =
          index?.cardChunks(pageId).filter((chunk) => chunk.layer <= 2) ?? [];
        if (live)
          setFound(card && chunks.length ? { card, chunks } : undefined);
      })
      .catch(() => live && setFound(undefined));
    return () => {
      live = false;
    };
  }, [pageId]);
  if (!found) return null;
  return (
    <div
      className="space-y-1.5 rounded-md bg-muted p-2"
      data-testid="no-cause-card"
    >
      <h4 className="text-xs font-medium text-muted-foreground">
        {t("checkPack.noCauseCard")}
      </h4>
      <p className="text-sm font-medium text-foreground">{found.card.title}</p>
      {found.chunks.map((chunk) => (
        <div key={chunk.id} className="space-y-0.5">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("kbMatches.layer", { layer: chunk.layer })}
            {chunk.notVerified && (
              <StatusBadge tone="warning">
                {t("checkPack.kbCard.notVerified")}
              </StatusBadge>
            )}
          </p>
          <p className="whitespace-pre-line text-sm text-foreground">
            {chunk.text}
          </p>
        </div>
      ))}
    </div>
  );
}
