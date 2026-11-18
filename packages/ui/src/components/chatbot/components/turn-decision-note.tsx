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

const DAY_MS = 86_400_000;

/**
 * Where a reply came from, on top of it (KB-RAG K27, E1): Check, KB card or
 * Model; the Apty version and how it was decided; and how long the pack it
 * used has left. Ids, numbers and codes only.
 */
export function TurnSourceChips({
  decision,
  kbCardsReturned,
  now = Date.now(),
}: {
  decision: TurnDecision;
  kbCardsReturned: boolean;
  now?: number;
}) {
  const { t } = useTranslation();
  const source =
    decision.route === "model"
      ? kbCardsReturned
        ? t("turnDecision.chip.modelWithCards")
        : t("turnDecision.chip.model")
      : t(`turnDecision.chip.${decision.route}`);
  const version =
    decision.version === "unknown"
      ? t("turnDecision.chip.versionUnknown")
      : t(
          decision.versionSource === "user"
            ? "turnDecision.chip.versionChosen"
            : "turnDecision.chip.versionFiles",
          { version: decision.version },
        );
  const expiries = decision.packs
    .map((pack) => (pack.expiresAt ? Date.parse(pack.expiresAt) : Number.NaN))
    .filter((at) => Number.isFinite(at));
  const soonest = expiries.length > 0 ? Math.min(...expiries) : undefined;
  const days =
    soonest === undefined ? undefined : Math.ceil((soonest - now) / DAY_MS);
  const chips = [
    source,
    version,
    ...(days === undefined
      ? []
      : [
          days > 1
            ? t("turnDecision.chip.packExpiresIn", { count: days })
            : days === 1
              ? t("turnDecision.chip.packExpiresInOne", { count: days })
              : t("turnDecision.chip.packExpired"),
        ]),
  ];
  return (
    <ul
      className="flex flex-wrap gap-1"
      aria-label={t("turnDecision.chip.label")}
      data-testid="turn-source-chips"
    >
      {chips.map((chip) => (
        <li
          key={chip}
          className="rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          {chip}
        </li>
      ))}
    </ul>
  );
}
