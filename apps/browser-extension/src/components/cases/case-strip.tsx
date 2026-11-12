/**
 * The conversation's case under the context bar (KB-RAG K25, L1): its id
 * with Copy, and once per panel, on a site with a case still open from the
 * last 24 hours, "Continue CASE-…". The case lives on this device only.
 */
import { type CaseRecord, caseToContinue } from "@apty/agent-core";
import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { useEffect, useState } from "react";
import { caseRecorder, setActiveConversation } from "../../services/cases";
import { useReadiness } from "../connections/use-readiness";

/** Whether the panel already offered a case to continue: once per panel. */
let offered = false;

/** The conversation's case, re-read whenever a turn or a close changes it. */
function useConversationCase(sessionId: string | null) {
  const [record, setRecord] = useState<CaseRecord | undefined>();
  useEffect(() => {
    setActiveConversation(sessionId);
    if (!sessionId) {
      setRecord(undefined);
      return undefined;
    }
    let live = true;
    const load = () => {
      caseRecorder()
        .current(sessionId)
        .then((found) => live && setRecord(found))
        .catch(() => live && setRecord(undefined));
    };
    load();
    const unsubscribe = caseRecorder().subscribe(load);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [sessionId]);
  return record;
}

export function CaseStrip({ children }: { children?: React.ReactNode }) {
  const { sessionId } = useChatContext();
  const { t } = useTranslation();
  const record = useConversationCase(sessionId);
  const { target } = useReadiness();
  const [copied, setCopied] = useState(false);
  const [offer, setOffer] = useState<CaseRecord | undefined>();

  useEffect(() => {
    if (offered || record || !target.hostname) return;
    let live = true;
    caseRecorder()
      .store.list()
      .then((cases) => {
        const found = caseToContinue(
          cases,
          target.hostname ?? undefined,
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
  }, [record, target.hostname, sessionId]);

  if (offer && !record) {
    return (
      <div
        className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-small"
        data-testid="case-continue"
      >
        <span className="min-w-0 flex-1 text-muted-foreground">
          {t("cases.continueText", { id: offer.id })}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (sessionId) void caseRecorder().continueIn(offer.id, sessionId);
            else caseRecorder().continueOnNextTurn(offer.id);
            setOffer(undefined);
          }}
        >
          {t("cases.continue", { id: offer.id })}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOffer(undefined)}>
          {t("common.dismiss")}
        </Button>
      </div>
    );
  }
  if (!record) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-1.5 text-small"
      data-testid="case-strip"
    >
      <span className="text-muted-foreground">{t("cases.label")}</span>
      <code className="font-mono text-foreground" data-testid="case-id">
        {record.id}
      </code>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t("cases.copyId", { id: record.id })}
        onClick={() => {
          void navigator.clipboard
            .writeText(record.id)
            .then(() => setCopied(true));
        }}
      >
        {t(copied ? "common.copied" : "common.copy")}
      </Button>
      {record.outcome !== "open" && (
        <span className="text-muted-foreground">
          {t(`cases.outcome.${record.outcome}`)}
        </span>
      )}
      {children}
    </div>
  );
}
