/**
 * Under a reply, the actions that apply to that turn (KB-RAG K27, E1). Only
 * actions that can run are offered, and none the turn's own card already
 * shows: Prepare support bundle for a turn with KB cards, or with a verdict
 * whose card does not offer it. Wrong card stays on each KB card, Get the
 * evidence on the verdict that needs files, and Run the check needs a KB
 * card mapped to a check pack (E5), so the row does not repeat or invent
 * them.
 */
import type { KbToolResult } from "@apty/browser-runtime/kb/kb-index";
import { ChatContext } from "@apty/ui/components/chatbot";
import type { UIMessage } from "@apty/ui/types";
import { useContext } from "react";
import { caseRecorder } from "../../services/cases";
import { isDiagnosisResult } from "../investigation/check-result-card";
import { SupportBundleButton } from "./support-bundle-button";

function outputOf(parts: UIMessage["parts"], toolName: string): unknown {
  for (const part of parts) {
    if (
      part.type === "tool" &&
      part.toolName === toolName &&
      part.state === "completed"
    ) {
      return part.output;
    }
  }
  return undefined;
}

/**
 * What the row offers for a turn's parts.
 * @internal exported for tests
 */
export function turnActions(parts: UIMessage["parts"]): {
  supportBundle: boolean;
} {
  const verdict = outputOf(parts, "run_diagnosis");
  const kb = outputOf(parts, "search_kb") as Partial<KbToolResult> | undefined;
  const kbCards = Array.isArray(kb?.cards) && kb.cards.length > 0;
  const verdictWithoutBundle =
    isDiagnosisResult(verdict) && verdict.verdict.nextCheck !== "sendSupport";
  return { supportBundle: kbCards || verdictWithoutBundle };
}

export function TurnActionRow({ parts }: { parts: UIMessage["parts"] }) {
  const sessionId = useContext(ChatContext)?.sessionId ?? null;
  const actions = turnActions(parts);
  if (!sessionId || !actions.supportBundle) return null;
  const verdict = outputOf(parts, "run_diagnosis");
  const result = isDiagnosisResult(verdict) ? verdict : undefined;
  const siteKey =
    result?.siteKey ??
    (outputOf(parts, "search_kb") as { siteKey?: string } | undefined)?.siteKey;
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="turn-actions"
    >
      <SupportBundleButton
        {...(result ? { result } : {})}
        loadRecord={async () => caseRecorder().current(sessionId, siteKey)}
      />
    </div>
  );
}
