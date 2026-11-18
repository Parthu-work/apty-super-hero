import type { TurnDecision } from "@apty/agent-core";
import { useState } from "react";
import { useTranslation } from "../../../i18n/context";
import { copyText } from "../../../lib/clipboard";
import { decisionDetails, kbOutcomeLine } from "../../../lib/turn-decision";

/**
 * Above the model's reply, one quiet line when the KB did not answer and
 * why (KB-RAG K25, A2); under it, the turn's decision record behind "Why
 * this answer", collapsed. Ids, numbers and codes only.
 */
export function TurnDecisionLine({ decision }: { decision: TurnDecision }) {
  const { t } = useTranslation();
  const line =
    decision.route === "model" ? kbOutcomeLine(decision.kb, t) : undefined;
  if (!line) return null;
  return (
    <p
      className="text-small text-muted-foreground"
      data-testid="kb-decision-line"
    >
      {`${line} ${t("turnDecision.askedModel")}`}
    </p>
  );
}

/** The record's lines as one text, for copying and exports (K27, F10): ids, numbers and codes only. */
export function decisionText(
  decision: TurnDecision,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return [
    t("turnDecision.why"),
    ...decisionDetails(decision, t).map((line) => `- ${line}`),
  ].join("\n");
}

export function TurnDecisionDetails({ decision }: { decision: TurnDecision }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-start gap-x-2">
      <details className="text-small" data-testid="turn-decision">
        <summary className="w-fit cursor-pointer rounded-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t("turnDecision.why")}
        </summary>
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {decisionDetails(decision, t).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <button
        type="button"
        className="rounded-sm text-small text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={t("turnDecision.copy")}
        onClick={() => {
          void copyText(decisionText(decision, t)).then(
            (ok) => ok && setCopied(true),
          );
        }}
      >
        {t(copied ? "common.copied" : "common.copy")}
      </button>
    </div>
  );
}
