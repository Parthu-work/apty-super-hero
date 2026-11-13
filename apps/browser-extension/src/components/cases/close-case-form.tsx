/**
 * Closing a case (KB-RAG K25, L3): Resolved, Escalated, Not covered or
 * Abandoned; for Resolved and Escalated, whether the finding was right and,
 * if not, which card was. The answer goes on the case and into the
 * feedback log on this device.
 */
import type { CaseOutcome, CaseRecord } from "@apty/agent-core";
import { recordOutcome } from "@apty/browser-runtime/case/feedback-store";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { useId, useState } from "react";
import { caseRecorder, caseStore } from "../../services/cases";

type Closing = Exclude<CaseOutcome, "open">;
const OUTCOMES: Closing[] = [
  "resolved",
  "escalated",
  "not_covered",
  "abandoned",
];
const ANSWERS = ["yes", "partly", "no"] as const;

export function CloseCaseForm({
  record,
  onDone,
}: {
  record: CaseRecord;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [outcome, setOutcome] = useState<Closing>("resolved");
  const [right, setRight] = useState<(typeof ANSWERS)[number] | undefined>();
  const [card, setCard] = useState("");
  const asks = outcome === "resolved" || outcome === "escalated";
  const shown = [
    ...new Set([
      ...(record.finding?.cardPageId ? [record.finding.cardPageId] : []),
      ...record.kbShown.flatMap((s) => s.cards.map((c) => c.pageId)),
    ]),
  ];

  const close = async () => {
    const closed = await caseRecorder().close(record.conversationId, outcome, {
      ...(asks && right ? { findingRight: right } : {}),
      ...(asks && right && right !== "yes" && card
        ? { rightCardId: card }
        : {}),
    });
    if (closed) await recordOutcome(caseStore(), closed);
    onDone();
  };

  return (
    <form
      className="w-full space-y-2 py-1"
      data-testid="close-case-form"
      onSubmit={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="mb-1 text-small font-medium text-foreground">
          {t("feedback.outcomeLabel")}
        </legend>
        {OUTCOMES.map((value) => (
          <label key={value} className="flex items-center gap-1 text-small">
            <input
              type="radio"
              name={`${id}-outcome`}
              value={value}
              checked={outcome === value}
              onChange={() => setOutcome(value)}
            />
            {t(`cases.outcome.${value}`)}
          </label>
        ))}
      </fieldset>
      {asks && (
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
          <legend className="mb-1 text-small font-medium text-foreground">
            {t("feedback.findingRight")}
          </legend>
          {ANSWERS.map((value) => (
            <label key={value} className="flex items-center gap-1 text-small">
              <input
                type="radio"
                name={`${id}-right`}
                value={value}
                checked={right === value}
                onChange={() => setRight(value)}
              />
              {t(`feedback.answer.${value}`)}
            </label>
          ))}
        </fieldset>
      )}
      {asks && right && right !== "yes" && (
        <label
          className="flex flex-col gap-1 text-small"
          htmlFor={`${id}-card`}
        >
          {t("feedback.rightCard")}
          <input
            id={`${id}-card`}
            list={`${id}-cards`}
            inputMode="numeric"
            value={card}
            onChange={(event) => setCard(event.target.value.replace(/\D/g, ""))}
            className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          />
          <datalist id={`${id}-cards`}>
            {shown.map((pageId) => (
              <option key={pageId} value={pageId} />
            ))}
          </datalist>
        </label>
      )}
      <div className="flex gap-2">
        <Button size="sm" type="submit">
          {t("feedback.confirmClose")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
