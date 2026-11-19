/**
 * Under a model turn the KB did not cover (KB-RAG K27, E7): the cards that
 * came closest, by title and link, marked "closest, may not match". Titles
 * come from this device's packs; the turn's record holds only their ids.
 */
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { useTranslation } from "@apty/ui/i18n/context";
import { ExternalLinkIcon } from "lucide-react";
import { useId } from "react";
import { type KbCardEntry, useKbCatalog } from "../../services/kb-cards";

export function KbClosestSuggestions({ pageIds }: { pageIds: string[] }) {
  const { t } = useTranslation();
  const titleId = useId();
  const catalog = useKbCatalog();
  const cards = pageIds.flatMap((pageId): KbCardEntry[] => {
    const card = catalog?.cards.find((c) => c.pageId === pageId);
    return card ? [card] : [];
  });
  if (cards.length === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="space-y-1 rounded-lg border border-dashed border-border bg-card p-3"
      data-testid="kb-closest"
    >
      <h3 id={titleId} className="text-sm font-medium text-foreground">
        {t("kbClosest.title")}
      </h3>
      <p className="text-small text-muted-foreground">
        {t("kbClosest.description")}
      </p>
      <ul className="space-y-1">
        {cards.map((card) => (
          <li
            key={`${card.aptyVersion}:${card.pageId}`}
            className="flex flex-wrap items-center gap-2"
          >
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {card.title}
              <ExternalLinkIcon aria-hidden="true" className="size-3" />
            </a>
            <StatusBadge tone="neutral">{card.aptyVersion}</StatusBadge>
          </li>
        ))}
      </ul>
    </section>
  );
}
