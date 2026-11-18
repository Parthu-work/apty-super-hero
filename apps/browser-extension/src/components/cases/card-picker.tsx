/**
 * Picks a KB card by its title (KB-RAG K27, E7): a combobox over the loaded
 * packs' card titles for Wrong card, so the SE no longer types a page id.
 * Arrow keys move through the matches, Enter picks one and Escape closes
 * the list; with the list closed, Enter submits the form. A typed page id
 * still counts.
 */
import { type KbCardTitle, searchCardTitles } from "@apty/agent-core";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { type KeyboardEvent, useId, useMemo, useState } from "react";

const MATCHES = 8;
const BLUR_CLOSE_MS = 200;

export function CardPicker({
  label,
  cards,
  onPick,
}: {
  label: string;
  cards: readonly KbCardTitle[];
  /** The picked card's id, a typed id, or undefined. */
  onPick: (pageId: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const listId = `${inputId}-list`;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<KbCardTitle>();
  const matches = useMemo(
    () => (text.trim() ? searchCardTitles(cards, text, MATCHES) : []),
    [cards, text],
  );
  const expanded = open && matches.length > 0;

  const choose = (card: KbCardTitle) => {
    setPicked(card);
    setText(card.title);
    setOpen(false);
    onPick(card.pageId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!expanded) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + matches.length) % matches.length);
    } else if (event.key === "Enter" && expanded) {
      event.preventDefault();
      const card = matches[active];
      if (card) choose(card);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 text-xs">
      <label htmlFor={inputId}>{label}</label>
      <div>
        <input
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            setPicked(undefined);
            setOpen(true);
            setActive(0);
            onPick(/^\d+$/.test(value.trim()) ? value.trim() : undefined);
          }}
          onKeyDown={onKeyDown}
          // Closed after the click that moved focus lands: the list sits
          // above the form's buttons, and closing it at once moves them.
          onBlur={() => window.setTimeout(() => setOpen(false), BLUR_CLOSE_MS)}
          className="h-8 w-64 max-w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
        {expanded && (
          <div
            id={listId}
            role="listbox"
            aria-label={t("feedback.pickerList")}
            className="mt-1 w-64 max-w-full rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          >
            {matches.map((card, i) => (
              <div
                key={`${card.aptyVersion ?? ""}:${card.pageId}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                className={cn(
                  "cursor-pointer rounded px-2 py-1",
                  i === active && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(card);
                }}
              >
                {card.title}
                <span className="text-muted-foreground">
                  {` ${card.pageId}${card.aptyVersion ? `, ${card.aptyVersion}` : ""}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <span role="status" className="sr-only">
        {open && text.trim()
          ? matches.length > 0
            ? t("feedback.pickerCount", { count: matches.length })
            : t("feedback.pickerNone")
          : ""}
      </span>
      {picked && (
        <span className="text-muted-foreground">
          {t("feedback.picked", { title: picked.title, pageId: picked.pageId })}
        </span>
      )}
    </div>
  );
}
