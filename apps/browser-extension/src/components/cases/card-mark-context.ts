import type { CaseRecord } from "@apty/agent-core";
import type { FeedbackPack } from "@apty/browser-runtime/case/feedback-store";
import { caseRecorder } from "../../services/cases";

/** What a card mark records beside the card: the conversation's case and the pack the card came from. */
export async function cardMarkContext(
  sessionId: string | null,
  aptyVersion: string | undefined,
): Promise<{ record?: CaseRecord; pack?: FeedbackPack }> {
  const record = sessionId
    ? await caseRecorder().current(sessionId)
    : undefined;
  // Loaded on use: the pack store opens IndexedDB.
  const packs = await import("../../services/kb-pack")
    .then(({ kbPackStore }) => kbPackStore().info())
    .catch(() => []);
  const pack = packs.find(
    (p) => p.aptyVersion === (aptyVersion ?? record?.aptyVersion),
  );
  return {
    ...(record ? { record } : {}),
    ...(pack ? { pack: { builtAt: pack.builtAt, sha256: pack.sha256 } } : {}),
  };
}
