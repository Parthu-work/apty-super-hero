/**
 * "Wrong card" on a KB matches hit and a verdict's KB excerpt (KB-RAG K25,
 * L3): records the card and layer shown, and optionally the card that was
 * right, as a feedback row on this device. The SE's question is kept
 * Strict-redacted and exported only when they choose.
 */
import { recordWrongCard } from "@apty/browser-runtime/case/feedback-store";
import { ChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { useContext, useId, useState } from "react";
import { caseRecorder, caseStore } from "../../services/cases";

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
  /** Cards shown beside it, offered as the right one. */
  otherCards?: Array<{ pageId: string; title: string }>;
}) {
  const { t } = useTranslation();
  const sessionId = useContext(ChatContext)?.sessionId ?? null;
  const [open, setOpen] = useState(false);
  const [right, setRight] = useState("");
  const [saved, setSaved] = useState(false);
  const inputId = useId();

  const save = async () => {
    const record = sessionId
      ? await caseRecorder().current(sessionId)
      : undefined;
    // Loaded on use: the pack store opens IndexedDB.
    const packs = await import("../../services/kb-pack")
      .then(({ kbPackStore }) => kbPackStore().info())
      .catch(() => []);
    const pack = packs.find(
      (p) => p.aptyVersion === (aptyVersion ?? record?.aptyVersion),
    );
    await recordWrongCard(caseStore(), {
      ...(record ? { record } : {}),
      shownCardId: pageId,
      ...(layer ? { shownLayer: layer } : {}),
      ...(right.trim() ? { rightCardId: right.trim() } : {}),
      ...(aptyVersion ? { aptyVersion } : {}),
      ...(pack ? { pack: { builtAt: pack.builtAt, sha256: pack.sha256 } } : {}),
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
  const datalistId = `${inputId}-cards`;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="flex flex-col gap-1 text-xs" htmlFor={inputId}>
        {t("feedback.rightCard")}
        <input
          id={inputId}
          list={datalistId}
          inputMode="numeric"
          value={right}
          onChange={(event) => setRight(event.target.value.replace(/\D/g, ""))}
          className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
        <datalist id={datalistId}>
          {otherCards
            .filter((card) => card.pageId !== pageId)
            .map((card) => (
              <option key={card.pageId} value={card.pageId}>
                {card.title}
              </option>
            ))}
        </datalist>
      </label>
      <Button size="sm" type="submit">
        {t("feedback.save")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}
