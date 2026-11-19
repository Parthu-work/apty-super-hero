/**
 * "Wrong card" on a KB matches hit and a verdict's KB excerpt (KB-RAG K25,
 * L3): records the card and layer shown, and optionally the card that was
 * right, as a feedback row on this device. The right card is picked by its
 * title from the loaded packs (K27, E7), the cards shown beside it first.
 * The SE's question is kept Strict-redacted and exported only when they
 * choose.
 */
import type { KbCardTitle } from "@apty/agent-core";
import { recordWrongCard } from "@apty/browser-runtime/case/feedback-store";
import { ChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { useContext, useMemo, useState } from "react";
import { caseStore } from "../../services/cases";
import { useKbCatalog } from "../../services/kb-cards";
import { cardMarkContext } from "./card-mark-context";
import { CardPicker } from "./card-picker";

export function WrongCardButton({
  pageId,
  layer,
  aptyVersion,
  question,
  otherCards = [],
}: {
  pageId: string;
  layer?: number;
  aptyVersion?: string;
  question?: string;
  /** Cards shown beside it, offered first as the right one. */
  otherCards?: Array<{ pageId: string; title: string }>;
}) {
  const { t } = useTranslation();
  const sessionId = useContext(ChatContext)?.sessionId ?? null;
  const [open, setOpen] = useState(false);
  const [right, setRight] = useState<string>();
  const [saved, setSaved] = useState(false);
  const catalog = useKbCatalog(open);
  const cards = useMemo(() => {
    const seen = new Set([pageId]);
    const list: KbCardTitle[] = [];
    for (const card of [...otherCards, ...(catalog?.cards ?? [])]) {
      if (seen.has(card.pageId)) continue;
      seen.add(card.pageId);
      list.push(card);
    }
    return list;
  }, [pageId, otherCards, catalog]);

  const save = async () => {
    const { record, pack } = await cardMarkContext(sessionId, aptyVersion);
    await recordWrongCard(caseStore(), {
      ...(record ? { record } : {}),
      shownCardId: pageId,
      ...(layer ? { shownLayer: layer } : {}),
      ...(right ? { rightCardId: right } : {}),
      ...(aptyVersion ? { aptyVersion } : {}),
      ...(pack ? { pack } : {}),
      ...(question ? { question } : {}),
    });
    setSaved(true);
    setOpen(false);
  };

  if (saved) {
    return (
      <span className="text-xs text-muted-foreground" role="status">
        {t("feedback.recorded")}
      </span>
    );
  }
  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={t("feedback.wrongCardFor", { pageId })}
        onClick={() => setOpen(true)}
      >
        {t("feedback.wrongCard")}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <CardPicker
        label={t("feedback.rightCardPick")}
        cards={cards}
        onPick={setRight}
      />
      <Button size="sm" type="submit">
        {t("feedback.save")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}
