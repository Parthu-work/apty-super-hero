/**
 * The decision record of a chat turn in plain words (KB-RAG K25, A2). It
 * holds ids, numbers and codes; nothing here shows card text or the
 * question.
 */
import type { KbDecision, TurnDecision } from "@apty/agent-core";
import type { I18nContextValue } from "../i18n/types";

type Translate = I18nContextValue["t"];

const fixed = (n: number) => n.toFixed(2);

/**
 * Why no KB card answered, in one sentence, or undefined when a card did or
 * the KB was not the right place (a how-to, D-KB1).
 */
export function kbOutcomeLine(
  kb: KbDecision | undefined,
  t: Translate,
): string | undefined {
  if (!kb) return undefined;
  switch (kb.kind) {
    case "not_covered":
      if (kb.reason === "no_strong_term") return t("turnDecision.noStrongTerm");
      if (kb.reason === "unknown_setting") {
        return t("turnDecision.unknownSetting");
      }
      return t("turnDecision.notCovered", {
        coverage: fixed(kb.coverage),
        min: fixed(kb.min),
      });
    case "no_pack":
      return kb.version === "unknown"
        ? t("turnDecision.noPackAny")
        : t("turnDecision.noPack", { version: kb.version });
    case "error":
      return t("turnDecision.error", { code: kb.code });
    case "pack_unusable":
      return t(`turnDecision.packUnusable.${kb.reason}`, {
        version: kb.version,
        date: kb.date?.slice(0, 10) ?? "",
      });
    default:
      return undefined;
  }
}

function outcomeWords(kb: KbDecision, t: Translate): string {
  switch (kb.kind) {
    case "answer":
      return t("turnDecision.outcome.answer", {
        status: kb.status,
        pageIds: kb.pageIds.join(", ") || "-",
      });
    case "not_covered":
      return t("turnDecision.outcome.notCovered", {
        reason: kb.reason,
        coverage: fixed(kb.coverage),
        min: fixed(kb.min),
        top: kb.topPageId ?? "-",
      });
    case "no_pack":
      return t("turnDecision.outcome.noPack", { version: kb.version });
    case "error":
      return t("turnDecision.outcome.error", { code: kb.code });
    case "pack_unusable":
      return t("turnDecision.outcome.packUnusable", {
        version: kb.version,
        reason: kb.reason,
      });
    case "how_to":
      return t("turnDecision.outcome.howTo");
    case "non_english":
      return t("turnDecision.outcome.nonEnglish");
    default:
      return "";
  }
}

/** The record, one fact per line, for the "Why this answer" disclosure. */
export function decisionDetails(
  decision: TurnDecision,
  t: Translate,
): string[] {
  const route =
    decision.route === "check"
      ? t("turnDecision.route.check", { pack: decision.checkPackId ?? "-" })
      : t(`turnDecision.route.${decision.route}`);
  const lines = [
    t("turnDecision.routeLine", { route }),
    t("turnDecision.versionLine", {
      version: decision.version,
      source: t(`turnDecision.source.${decision.versionSource}`),
    }),
    decision.packs.length > 0
      ? t("turnDecision.packsLine", {
          packs: decision.packs
            .map((pack) =>
              [
                `${pack.version} ${pack.sha256}`,
                pack.keyId ? `key ${pack.keyId}` : "",
                pack.expiresAt ? `expires ${pack.expiresAt.slice(0, 10)}` : "",
              ]
                .filter(Boolean)
                .join(", "),
            )
            .join("; "),
        })
      : t("turnDecision.packsNone"),
  ];
  if (decision.kb) {
    lines.push(
      t("turnDecision.kbLine", { outcome: outcomeWords(decision.kb, t) }),
    );
  }
  return lines;
}
