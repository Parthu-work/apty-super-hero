/**
 * Under a reply, the actions that apply to that turn (KB-RAG K27, E1, E5).
 * Only actions that can run are offered, and none the turn's own card
 * already shows: Run the check under a KB card whose symptom a check pack
 * reads; Prepare support bundle for a turn with KB cards, or with a verdict
 * whose card does not offer it; and, after a confirmed cause, the SE's
 * right-or-wrong mark on it. Wrong card stays on each KB card and Get the
 * evidence on the verdict that needs files, so the row does not repeat them.
 */
import type { CaseRecord, RunCheckRequest } from "@apty/agent-core";
import type { KbToolResult } from "@apty/browser-runtime/kb/kb-index";
import { ChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { UIMessage } from "@apty/ui/types";
import { useContext, useId, useState } from "react";
import { caseRecorder } from "../../services/cases";
import { isDiagnosisResult } from "../investigation/check-result-card";
import { SupportBundleButton } from "./support-bundle-button";

type ToolPart = Extract<UIMessage["parts"][number], { type: "tool" }>;

function partOf(
  parts: UIMessage["parts"],
  toolName: string,
): ToolPart | undefined {
  return parts.find(
    (part): part is ToolPart =>
      part.type === "tool" &&
      part.toolName === toolName &&
      part.state === "completed",
  );
}

/**
 * What the row offers for a turn's parts.
 * @internal exported for tests
 */
export function turnActions(parts: UIMessage["parts"]): {
  supportBundle: boolean;
  runCheck?: RunCheckRequest;
  markFinding: boolean;
} {
  const verdict = partOf(parts, "run_diagnosis")?.output;
  const kb = partOf(parts, "search_kb")?.output as
    | Partial<KbToolResult>
    | undefined;
  const kbCards = Array.isArray(kb?.cards) && kb.cards.length > 0;
  const result = isDiagnosisResult(verdict) ? verdict : undefined;
  const verdictWithoutBundle =
    result !== undefined && result.verdict.nextCheck !== "sendSupport";
  return {
    supportBundle: kbCards || verdictWithoutBundle,
    ...(kbCards && kb?.runCheck ? { runCheck: kb.runCheck } : {}),
    markFinding:
      result?.verdict.status === "cause_found" &&
      result.verdict.causes.length > 0,
  };
}

type Mark = Exclude<NonNullable<CaseRecord["findingRight"]>, "partly">;

function FindingMark({
  sessionId,
  siteKey,
}: {
  sessionId: string;
  siteKey: string | undefined;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const [mark, setMark] = useState<Mark | undefined>();
  const [noCase, setNoCase] = useState(false);
  const choose = async (value: Mark) => {
    const marked = await caseRecorder().markFinding(sessionId, value, siteKey);
    setNoCase(!marked);
    setMark(marked ? value : undefined);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <fieldset
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-1"
      >
        <span id={labelId} className="text-small text-muted-foreground">
          {t("turnActions.markLabel")}
        </span>
        {(["yes", "no"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={mark === value ? "secondary" : "ghost"}
            aria-pressed={mark === value}
            onClick={() => void choose(value)}
          >
            {t(`turnActions.mark.${value}`)}
          </Button>
        ))}
      </fieldset>
      <span role="status" className="text-small text-muted-foreground">
        {noCase
          ? t("turnActions.noCase")
          : mark
            ? t(`turnActions.marked.${mark}`)
            : ""}
      </span>
    </div>
  );
}

export function TurnActionRow({ parts }: { parts: UIMessage["parts"] }) {
  const { t } = useTranslation();
  const chat = useContext(ChatContext);
  const sessionId = chat?.sessionId ?? null;
  const actions = turnActions(parts);
  if (
    !sessionId ||
    (!actions.supportBundle && !actions.runCheck && !actions.markFinding)
  ) {
    return null;
  }
  const verdict = partOf(parts, "run_diagnosis")?.output;
  const result = isDiagnosisResult(verdict) ? verdict : undefined;
  const kbPart = partOf(parts, "search_kb");
  const siteKey =
    result?.siteKey ?? (kbPart?.output as { siteKey?: string })?.siteKey;
  const question = (kbPart?.input as { query?: unknown } | undefined)?.query;
  const runCheck = actions.runCheck;
  const busy = chat?.status !== "idle" && chat?.status !== "error";
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="turn-actions"
    >
      {runCheck && typeof question === "string" && question && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void chat?.sendMessage(question, undefined, undefined, {
              runCheck,
            })
          }
        >
          {t("turnActions.runCheck")}
        </Button>
      )}
      {actions.supportBundle && (
        <SupportBundleButton
          {...(result ? { result } : {})}
          loadRecord={async () => caseRecorder().current(sessionId, siteKey)}
        />
      )}
      {actions.markFinding && (
        <FindingMark sessionId={sessionId} siteKey={siteKey} />
      )}
    </div>
  );
}
