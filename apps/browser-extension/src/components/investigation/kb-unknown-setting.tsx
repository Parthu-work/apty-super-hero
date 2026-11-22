/**
 * KB-RAG K27, F2: a question naming a setting no KB card has is answered
 * by the KB, not the model: the missing name, the closest cards (they may
 * not mention it) and where to look instead. "Ask the AI anyway" sends the
 * question to the model with a fixed instruction not to describe Apty
 * settings, menus, paths, prices or features, the KB's outcome as a fact,
 * and no guess at where such a setting might be (K29, B6).
 */
import { kbCardUrl, kbUnknownSettingInstruction } from "@apty/agent-core";
import type { KbClosestCard } from "@apty/browser-runtime/kb/kb-index";
import { ChatContext } from "@apty/ui/components/chatbot";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { ExternalLinkIcon } from "lucide-react";
import { useContext } from "react";

const CARD_CITE = /^kb:\/\/(\d+)$/;

const LINK_CLASS =
  "inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function UnknownSettingCard({
  title,
  query,
  missing,
  closest,
}: {
  title: string;
  query: string;
  missing: readonly string[];
  closest: readonly KbClosestCard[];
}) {
  const { t } = useTranslation();
  const chat = useContext(ChatContext);
  return (
    <section
      aria-label={title}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
      data-testid="kb-unknown-setting"
    >
      {missing.map((phrase) => (
        <p key={phrase} className="text-sm font-medium text-foreground">
          {t("kbMatches.unknownSetting", { phrase })}
        </p>
      ))}
      {closest.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {t("kbMatches.closestCards")}
          </p>
          <ul className="space-y-1">
            {closest.map((card) => (
              <li key={card.cite} className="flex flex-wrap items-center gap-2">
                <a
                  href={kbCardUrl(CARD_CITE.exec(card.cite)?.[1] ?? "", {
                    site: card.site,
                    space: card.space,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={LINK_CLASS}
                >
                  {card.title}
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                </a>
                <StatusBadge tone="neutral">{card.aptyVersion}</StatusBadge>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-sm text-foreground">{t("kbMatches.checkStudio")}</p>
      {chat && query && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={chat.status !== "idle" && chat.status !== "error"}
          onClick={() =>
            void chat.sendMessage(query, undefined, undefined, {
              skipLocalResponder: true,
              turnInstruction: kbUnknownSettingInstruction(missing),
              followsKb: { kind: "unknown_setting", phrases: [...missing] },
            })
          }
        >
          {t("kbMatches.askAiAnyway")}
        </Button>
      )}
    </section>
  );
}
