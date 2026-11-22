/**
 * The conversation's case in the header's context line (KB-RAG K29, L1;
 * K25, L1): a chip with the short case id whose menu copies the id, starts
 * a new case, closes the case and opens Options → Cases. Once per panel, on
 * a site with a case still open from the last 24 hours, the chip offers
 * "Continue". The case lives on this device only.
 */
import { type CaseRecord, caseToContinue } from "@apty/agent-core";
import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@apty/ui/components/ui/dropdown-menu";
import { useTranslation } from "@apty/ui/i18n/context";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { openOptions } from "../../lib/open-options";
import { caseRecorder, setActiveConversation } from "../../services/cases";
import { useReadiness } from "../connections/use-readiness";
import { CloseCaseForm } from "./close-case-form";
import { useSiteLabels } from "./use-site-label";

/** Whether the panel already offered a case to continue: once per panel. */
let offered = false;

/** The last group of a case id (CASE-20261122-AB12 → AB12). */
function shortCaseId(id: string): string {
  return id.slice(id.lastIndexOf("-") + 1);
}

/** The conversation's case on the tab's site, re-read whenever a turn or a close changes it (K27, F4). */
function useConversationCase(sessionId: string | null, site?: string) {
  const [record, setRecord] = useState<CaseRecord | undefined>();
  useEffect(() => {
    setActiveConversation(sessionId, site);
    if (!sessionId) {
      setRecord(undefined);
      return undefined;
    }
    let live = true;
    const load = () => {
      caseRecorder()
        .current(sessionId, site)
        .then((found) => live && setRecord(found))
        .catch(() => live && setRecord(undefined));
    };
    load();
    const unsubscribe = caseRecorder().subscribe(load);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [sessionId, site]);
  return record;
}

/** A case on this site still open from the last 24 hours, offered once per panel while the chat has none. */
function useCaseOffer(
  record: CaseRecord | undefined,
  host: string | undefined,
  sessionId: string | null,
) {
  const [offer, setOffer] = useState<CaseRecord | undefined>();
  useEffect(() => {
    if (offered || record || !host) return;
    let live = true;
    caseRecorder()
      .store.list()
      .then((cases) => {
        const found = caseToContinue(
          cases,
          host,
          new Date(),
          sessionId ?? undefined,
        );
        if (live && found && !offered) {
          offered = true;
          setOffer(found);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [record, host, sessionId]);
  return [offer, setOffer] as const;
}

function ContinueOffer({
  offer,
  onDone,
}: {
  offer: CaseRecord;
  onDone: () => void;
}) {
  const { sessionId } = useChatContext();
  const { t } = useTranslation();
  const text = t("cases.continueText", { id: offer.id });
  return (
    <span
      className="flex shrink-0 items-center gap-0.5"
      data-testid="case-continue"
    >
      <span className="sr-only">{text}</span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 px-2 text-xs"
        title={text}
        onClick={() => {
          if (sessionId) void caseRecorder().continueIn(offer.id, sessionId);
          else caseRecorder().continueOnNextTurn(offer.id);
          onDone();
        }}
      >
        {t("cases.continueShort", { id: shortCaseId(offer.id) })}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="size-7"
        aria-label={t("cases.dismissContinue", { id: offer.id })}
        onClick={onDone}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </span>
  );
}

export function CaseChip() {
  const { sessionId } = useChatContext();
  const { t } = useTranslation();
  const { target } = useReadiness();
  const site = target.hostname ?? undefined;
  const record = useConversationCase(sessionId, site);
  const [offer, setOffer] = useCaseOffer(record, site, sessionId);
  const { label } = useSiteLabels();
  const [copied, setCopied] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (offer && !record) {
    return <ContinueOffer offer={offer} onDone={() => setOffer(undefined)} />;
  }
  if (!record) return null;
  const Icon = copied ? CheckIcon : FolderOpenIcon;
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-7 min-w-0 shrink-0 gap-1 px-1.5 text-xs"
            data-testid="case-chip"
            data-case-id={record.id}
            title={record.id}
            aria-label={[
              t("cases.chipName", { id: record.id }),
              ...(record.outcome !== "open"
                ? [t(`cases.outcome.${record.outcome}`)]
                : []),
            ].join(", ")}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            <span className="font-mono">{shortCaseId(record.id)}</span>
            {record.outcome !== "open" && (
              <span
                className="truncate text-muted-foreground"
                data-testid="case-outcome"
              >
                {t(`cases.outcome.${record.outcome}`)}
              </span>
            )}
            <ChevronDownIcon aria-hidden="true" className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="space-y-0.5">
            <code className="block font-mono text-foreground">{record.id}</code>
            {record.tabHost && (
              <span
                className="block text-xs font-normal text-muted-foreground"
                data-testid="case-site"
              >
                {t("cases.site", { site: label(record.tabHost) ?? "" })}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              void navigator.clipboard
                .writeText(record.id)
                .then(() => setCopied(true));
            }}
          >
            <CopyIcon aria-hidden="true" />
            {t("cases.copyCaseId")}
          </DropdownMenuItem>
          {sessionId && (
            <DropdownMenuItem
              onSelect={() => void caseRecorder().startNew(sessionId, site)}
            >
              <PlusIcon aria-hidden="true" />
              {t("cases.newCase")}
            </DropdownMenuItem>
          )}
          {record.outcome === "open" && (
            <DropdownMenuItem onSelect={() => setClosing(true)}>
              <CheckIcon aria-hidden="true" />
              {t("cases.closeCaseMenu")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => void openOptions({ section: "cases" })}
          >
            <ExternalLinkIcon aria-hidden="true" />
            {t("cases.openInCases")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="sr-only" aria-live="polite">
        {copied ? t("common.copied") : ""}
      </span>
      {closing && (
        <div className="absolute inset-x-2 top-full z-20 mt-2 rounded-lg border border-border bg-card p-3 shadow-md">
          <CloseCaseForm record={record} onDone={() => setClosing(false)} />
        </div>
      )}
    </>
  );
}
