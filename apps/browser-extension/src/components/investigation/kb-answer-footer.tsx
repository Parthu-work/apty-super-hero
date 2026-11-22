/**
 * Under a KB answer (KB-RAG K29, D2): one muted source line, "From the KB ·
 * 5.x · verified on 5.x code", whose (i) holds where the card comes from,
 * whether its text goes to the AI model and the pack's expiry; then one
 * action row: Helpful, Wrong card and a ⋯ menu with Copy answer, Why this
 * answer, Prepare support bundle and Open in Confluence. What the answer
 * used to show around its cards is here, one click away.
 */
import type { KbLayer } from "@apty/agent-core";
import { ChatContext, useTurn } from "@apty/ui/components/chatbot";
import {
  decisionText,
  packExpiryText,
  WhyThisAnswerPanel,
} from "@apty/ui/components/chatbot/components/turn-decision-note";
import { Button } from "@apty/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@apty/ui/components/ui/dropdown-menu";
import { useTranslation } from "@apty/ui/i18n/context";
import { copyText } from "@apty/ui/lib/clipboard";
import { InfoIcon, MoreHorizontalIcon } from "lucide-react";
import { useContext, useId, useState } from "react";
import { caseRecorder } from "../../services/cases";
import { HelpedButton } from "../cases/helped-button";
import { useSupportBundle } from "../cases/support-bundle-button";
import { WrongCardButton } from "../cases/wrong-card-button";
import { useKbEgressLine } from "./kb-egress-note";
import { layerSteps } from "./kb-layer-switcher";

/** The open card of a KB answer. */
export interface KbFooterCard {
  pageId: string;
  layer: KbLayer;
  title: string;
  url: string;
  text: string;
  aptyVersion?: string;
  verifiedOn?: string | null;
}

const VERIFIED_PREFIX = /^verified on\s*:?\s*/i;

/** "Verified on: 5.x code, 2026-01-01." → "5.x code, 2026-01-01". */
function verifiedWhat(line: string | null | undefined): string | undefined {
  const what = line?.trim().replace(VERIFIED_PREFIX, "").replace(/\.$/, "");
  return what || undefined;
}

/** The card as text: title and version, its steps numbered, its link. */
function cardText(card: KbFooterCard): string {
  return [
    card.aptyVersion ? `${card.title} (${card.aptyVersion})` : card.title,
    ...layerSteps(card.text).map((step, i) => `${i + 1}. ${step}`),
    card.url,
  ].join("\n");
}

export function KbAnswerFooter({
  card,
  question,
  otherCards = [],
}: {
  card?: KbFooterCard;
  question: string;
  otherCards?: Array<{ pageId: string; title: string }>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const turn = useTurn();
  const sessionId = useContext(ChatContext)?.sessionId ?? null;
  const egress = useKbEgressLine();
  const [infoOpen, setInfoOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const bundle = useSupportBundle({
    loadRecord: async () =>
      sessionId ? caseRecorder().current(sessionId) : undefined,
  });
  const decision = turn?.decision;
  const why = decision?.route === "kb" ? decision : undefined;
  const version = card?.aptyVersion ?? decision?.version;
  const verified = verifiedWhat(card?.verifiedOn);
  const source = [
    t("kbMatches.fromKb"),
    ...(version && version !== "unknown" ? [version] : []),
    ...(verified ? [t("kbMatches.verifiedOnShort", { what: verified })] : []),
  ].join(" · ");
  const expiry = decision ? packExpiryText(decision, t) : undefined;
  const about = [
    t("kbMatches.provenance"),
    egress,
    ...(expiry ? [expiry] : []),
  ];

  const copyAnswer = async () => {
    const body = card ? cardText(card) : question;
    const text = decision ? `${body}\n\n${decisionText(decision, t)}` : body;
    setCopied(await copyText(text));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p
          className="min-w-0 text-xs text-muted-foreground"
          data-testid="kb-source-line"
        >
          {source}
        </p>
        <span className="relative inline-flex">
          <button
            type="button"
            aria-label={t("kbMatches.aboutSource")}
            aria-expanded={infoOpen}
            aria-controls={`${id}-about`}
            aria-describedby={`${id}-about`}
            className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => setInfoOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setInfoOpen(false);
            }}
          >
            <InfoIcon aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      </div>
      <div
        id={`${id}-about`}
        role="note"
        hidden={!infoOpen}
        className="space-y-0.5 rounded-md bg-muted p-2 text-xs text-foreground"
      >
        {about.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <div
        className="flex flex-wrap items-center gap-1"
        data-testid="kb-action-row"
      >
        {card && (
          <>
            <HelpedButton
              pageId={card.pageId}
              layer={card.layer}
              aptyVersion={card.aptyVersion}
            />
            <WrongCardButton
              pageId={card.pageId}
              layer={card.layer}
              aptyVersion={card.aptyVersion}
              question={question}
              otherCards={otherCards}
            />
          </>
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={t("kbMatches.moreActions")}
            >
              <MoreHorizontalIcon aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => void copyAnswer()}>
              {t("kbMatches.copyAnswer")}
            </DropdownMenuItem>
            {why && (
              <DropdownMenuItem onSelect={() => setWhyOpen(true)}>
                {t("turnDecision.why")}
              </DropdownMenuItem>
            )}
            {sessionId && (
              <DropdownMenuItem
                disabled={bundle.emptyNow}
                onSelect={() => void bundle.prepare()}
              >
                {t("supportBundle.prepare")}
              </DropdownMenuItem>
            )}
            {card && (
              <DropdownMenuItem asChild>
                <a href={card.url} target="_blank" rel="noopener noreferrer">
                  {t("kbMatches.openInConfluence")}
                </a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span role="status" className="text-xs text-muted-foreground">
          {copied ? t("common.copied") : ""}
        </span>
      </div>
      {why && whyOpen && (
        <WhyThisAnswerPanel decision={why} onClose={() => setWhyOpen(false)} />
      )}
      {bundle.view}
    </div>
  );
}
